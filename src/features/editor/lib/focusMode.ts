import { RangeSetBuilder } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'

import { focusDimColor } from '@/shared/lib/focusDimColor'

/**
 * Focus mode: dims every line in the EDITOR except the paragraph the cursor
 * is currently in. Same "pure core, thin CodeMirror wrapper" split as
 * `listIndent.ts`/`taskList.ts` — `findActiveParagraph` below is a plain
 * function of document text + a 1-based cursor line number, unit-tested on
 * its own with no `EditorState` involved; everything after it is the
 * CodeMirror-facing shell (`focusModeExtension`) `useCodeMirror.ts` registers
 * through a `Compartment`, the same way it already does for line wrap/spell
 * check/word completion (toggling reconfigures live, never a state rebuild —
 * undo history and cursor survive a toggle).
 *
 * PARAGRAPH DEFINITION — a maximal run of consecutive non-blank lines
 * containing the cursor's own line ("blank" = empty or whitespace-only),
 * with one override:
 *
 *   - FENCED CODE: if the cursor sits anywhere within a fenced code span
 *     (```/~~~, including the delimiter lines themselves, an unclosed fence
 *     running to the end of the document, or a blank line INSIDE the fence),
 *     the whole span is the active range, even though it may contain blank
 *     lines of its own — a fence's blank lines are part of the code, not
 *     paragraph separators. This is the one case that isn't just "expand to
 *     the surrounding blank lines" (see `findFenceRange` below).
 *   - HEADING / LIST ITEM / TABLE: no special-casing needed — all three fall
 *     out of the plain blank-line rule already. A heading conventionally
 *     surrounded by blank lines lights up alone; a list with no blank lines
 *     between its items is one contiguous non-blank run, so the WHOLE list
 *     lights up together (not just the item the cursor is on) — the reading
 *     the task calls out as expected. A GFM table can't contain a blank row
 *     at all (a blank line always ends a table), so a table is likewise
 *     always one contiguous block by the same rule with no extra code.
 *   - BLANK-LINE CURSOR: when the cursor's own line is blank AND not inside
 *     a fence, nothing is "the" active paragraph — there is no paragraph to
 *     exempt from dimming, so the whole document dims. This is a deliberate
 *     choice (documented here since the task calls it out as a decision
 *     point), not a fallback to the nearest paragraph: inventing a "closest"
 *     paragraph would make the highlighted region jump around independent of
 *     where the cursor visually is, which is the opposite of what focus mode
 *     is for.
 *   - EMPTY DOCUMENT: a single empty line is a blank-line cursor by the rule
 *     above, so `findActiveParagraph` returns `null` — nothing to dim
 *     against anyway.
 */

export interface ActiveParagraphRange {
  /** 1-based, inclusive — matches `state.doc.line(n)`'s own numbering (same
   * convention `listIndent.ts`/`taskList.ts` already use). */
  fromLine: number
  toLine: number
}

const FENCE_LINE_PATTERN = /^ {0,3}(`{3,}|~{3,})/

function isFenceLine(line: string): boolean {
  return FENCE_LINE_PATTERN.test(line)
}

/**
 * Scans the whole document for alternating fence-delimiter lines (the same
 * "odd count of fence lines before this one means it's inside a fence" logic
 * as `listIndent.ts`'s `isFencedCodeLine`), but returns the matched span's
 * own `[start, end]` line numbers rather than a boolean — focus mode needs
 * the actual range to light up, not just a yes/no. Returns `null` when
 * `cursorLine` isn't inside any fenced span, open or closed.
 */
function findFenceRange(lines: readonly string[], cursorLine: number): ActiveParagraphRange | null {
  let fenceStart: number | null = null
  for (let n = 1; n <= lines.length; n++) {
    if (!isFenceLine(lines[n - 1])) continue
    if (fenceStart === null) {
      fenceStart = n
      continue
    }
    if (cursorLine >= fenceStart && cursorLine <= n) {
      return { fromLine: fenceStart, toLine: n }
    }
    fenceStart = null
  }
  // An opener with no matching closer swallows to the end of the document —
  // same "unclosed fence" treatment `listIndent.ts` gives an in-progress
  // fence (everything after the opener is still "code" as far as this
  // feature is concerned, closed or not).
  if (fenceStart !== null && cursorLine >= fenceStart) {
    return { fromLine: fenceStart, toLine: lines.length }
  }
  return null
}

/**
 * The pure "which lines are the active paragraph" core. `cursorLine` is
 * 1-based; out-of-range values return `null` (nothing to light up) the same
 * way a blank-line cursor does. See the module doc comment above for the
 * full paragraph definition and the fenced-code / blank-line-cursor /
 * empty-document decisions.
 */
export function findActiveParagraph(
  source: string,
  cursorLine: number,
): ActiveParagraphRange | null {
  const lines = source.split('\n')
  if (cursorLine < 1 || cursorLine > lines.length) return null

  // Fenced code is checked BEFORE the blank-line short-circuit below: a
  // blank line inside a fence must still resolve to the whole fenced span,
  // not to "nothing active".
  const fenceRange = findFenceRange(lines, cursorLine)
  if (fenceRange) return fenceRange

  if (lines[cursorLine - 1].trim() === '') return null

  // Expand outward from the cursor's line while the neighbour is neither
  // blank nor a fence delimiter — a fence boundary starts a new block even
  // with no blank line separating it from surrounding prose (CommonMark
  // itself lets a fenced code block interrupt a paragraph without one).
  let fromLine = cursorLine
  while (fromLine > 1 && lines[fromLine - 2].trim() !== '' && !isFenceLine(lines[fromLine - 2])) {
    fromLine--
  }
  let toLine = cursorLine
  while (toLine < lines.length && lines[toLine].trim() !== '' && !isFenceLine(lines[toLine])) {
    toLine++
  }
  return { fromLine, toLine }
}

// --- CodeMirror wiring -----------------------------------------------------

const FOCUS_DIM_LINE_CLASS = 'cm-focus-dim'
const focusDimLineDecoration = Decoration.line({ attributes: { class: FOCUS_DIM_LINE_CLASS } })

/**
 * Builds the full-document decoration set for the CURRENT selection/doc —
 * every line outside the active paragraph gets `.cm-focus-dim`. O(document
 * length): unavoidable here the same way it already is for
 * `wordCompletion.ts`'s per-keystroke extraction and `listIndent.ts`'s own
 * fence scan — `findActiveParagraph` needs the whole document to find fence
 * boundaries and paragraph edges, and every OTHER line's own decoration
 * range has to be (re)built regardless, since a docChanged update shifts
 * every line's character offsets, not just the edited one. `FocusModeView`
 * below is what keeps this from running on every no-op update (a selection
 * change that stays on the same line, or a document read with focus mode
 * off).
 */
function buildFocusModeDecorations(view: EditorView): DecorationSet {
  const { doc, selection } = view.state
  const cursorLine = doc.lineAt(selection.main.head).number
  const active = findActiveParagraph(doc.toString(), cursorLine)
  const builder = new RangeSetBuilder<Decoration>()
  for (let n = 1; n <= doc.lines; n++) {
    if (active && n >= active.fromLine && n <= active.toLine) continue
    const from = doc.line(n).from
    builder.add(from, from, focusDimLineDecoration)
  }
  return builder.finish()
}

/**
 * Recomputes decorations on document changes (typing, paste, undo/redo —
 * anything that could move a blank line or a fence boundary) and on
 * selection changes that land on a DIFFERENT line than before (moving the
 * cursor within the same line — arrow-left/right, extending a selection —
 * can never change which lines are dimmed, so those updates are skipped
 * rather than re-running the full O(document) scan above for nothing).
 */
class FocusModeView {
  decorations: DecorationSet
  private lastCursorLine: number

  constructor(view: EditorView) {
    this.lastCursorLine = view.state.doc.lineAt(view.state.selection.main.head).number
    this.decorations = buildFocusModeDecorations(view)
  }

  update(update: ViewUpdate): void {
    const cursorLine = update.state.doc.lineAt(update.state.selection.main.head).number
    if (!update.docChanged && cursorLine === this.lastCursorLine) return
    this.lastCursorLine = cursorLine
    this.decorations = buildFocusModeDecorations(update.view)
  }
}

const focusModeViewPlugin = ViewPlugin.fromClass(FocusModeView, {
  decorations: (v) => v.decorations,
})

/**
 * CONTRAST — this feature deliberately lowers contrast, so the dimmed
 * colour is a single measured value rather than a bare CSS `opacity` on
 * `.cm-line`. Opacity would MULTIPLY with tokens that are already partially
 * transparent by design (`daisyHighlightStyle`'s `t.meta`/`t.comment` at
 * 0.5, `t.quote` at 0.7 — see `theme.ts`) — and `t.meta`/`t.comment`
 * measured BELOW the 4.5:1 floor already, on the light theme, even at their
 * existing full (undimmed) 0.5 opacity (3.285:1 light, 3.149:1 light+soft —
 * see the task report), so multiplying that by any further dim factor could
 * only make an already-failing case worse. An override color sidesteps this
 * entirely: every dimmed line's text — plain prose or any syntax-highlighted
 * token — is forced to the SAME tone, so the floor is guaranteed regardless
 * of what colour/opacity the token would otherwise have used. `!important`
 * is required to win against `daisyHighlightStyle`'s own per-tag rules (some
 * of which match at equal or higher selector specificity than a bare
 * descendant selector could beat on specificity alone); nothing else in this
 * codebase uses `!important` on a colour today, so this is a deliberate,
 * narrow exception, not a habit.
 *
 * USER-ADJUSTABLE LEVEL — this used to be a single fixed 65% constant
 * (`color-mix(in srgb, var(--color-base-content) 65%, var(--color-base-100))`,
 * built with `shared/lib/focusDimColor.ts`'s formula). It is now a Settings
 * slider ("Focus dim level", next to the Focus mode toggle in
 * `features/settings/ui/SettingsModal.vue`), so the colour itself has moved
 * out of this file: `--md-focus-dim-color` is written by
 * `features/settings/model/editorPreferences.ts`'s `applyEditorCssVarsFx`
 * (the same mechanism that already applies editor font size/family/reading
 * width as CSS custom properties, no Compartment reconfigure needed for a
 * pure colour change), and this rule just reads it — the `var(...)`
 * fallback below is the OLD fixed value, used only if that property is
 * somehow never set (e.g. a unit test that mounts this extension without the
 * settings feature). See `editorPreferences.ts`'s own `FOCUS_DIM_LEVEL_MIN`
 * comment for the full derivation of the slider's range (still anchored to
 * the same 4.5:1 WCAG AA floor, across the same four theme x soft-contrast
 * combinations, that justified the original fixed 65%) — nothing about the
 * CONTRAST reasoning above changed, only where the specific percentage comes
 * from.
 */
const FOCUS_DIM_COLOR = `var(--md-focus-dim-color, ${focusDimColor(65)})`

/**
 * `@media (prefers-reduced-motion: no-preference)`-gated transition, same
 * pattern (and same reasoning) as `theme.ts`'s `.cm-line` jump-flash
 * transition just above it — a reduced-motion user gets an instant dim/
 * undim instead of an animated fade; the dimming itself still applies
 * either way, only the motion is skipped.
 */
const focusModeTheme = EditorView.theme({
  [`.${FOCUS_DIM_LINE_CLASS}, .${FOCUS_DIM_LINE_CLASS} *`]: {
    color: `${FOCUS_DIM_COLOR} !important`,
  },
  '@media (prefers-reduced-motion: no-preference)': {
    [`.${FOCUS_DIM_LINE_CLASS}`]: {
      transition: 'color 150ms ease-out',
    },
  },
})

/**
 * The full extension `useCodeMirror.ts` puts behind its `focusModeCompartment`
 * — `[]` when the setting is off, this array when on, reconfigured live on
 * toggle (never a state rebuild, so undo history/cursor survive it, same as
 * every other togglable preference in that file). Editor-only by
 * construction: this is a `ViewPlugin`/`EditorView.theme`, which only ever
 * attaches to the CodeMirror instance `useCodeMirror.ts` owns — the preview
 * pane (`features/preview`) has no notion this extension exists, so it can
 * never be dimmed by it.
 */
export const focusModeExtension: Extension = [focusModeViewPlugin, focusModeTheme]

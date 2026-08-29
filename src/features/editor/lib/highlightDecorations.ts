import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import { StateEffect, StateField, type Extension } from '@codemirror/state'

import type { HighlightColorId } from '@/shared/config/highlightColors'

/** One highlight, as the editor needs it: a span, an identity to report
 * back, and a colour to paint. Narrower than `documents`' `Highlight` — the
 * editor has no use for the note or the owning document. */
export interface EditorHighlight {
  id: string
  from: number
  to: number
  color: HighlightColorId
}

/** Replaces the whole set. A wholesale replace rather than add/remove
 * effects because the set is owned OUTSIDE the editor (`features/highlights`
 * holds the authoritative list and persists it); an incremental protocol
 * would give the editor a second, independent copy that could drift from it. */
export const setHighlightsEffect = StateEffect.define<readonly EditorHighlight[]>()

function buildDecorations(
  highlights: readonly EditorHighlight[],
  docLength: number,
): DecorationSet {
  const ranges = highlights
    // Clamp defensively: a set can arrive a beat before the document it was
    // computed against (switching documents dispatches both, and nothing
    // guarantees the order). An out-of-range decoration throws and takes the
    // whole editor with it, so this drops rather than trusts.
    .filter((highlight) => highlight.from < highlight.to && highlight.to <= docLength)
    .map((highlight) =>
      Decoration.mark({
        class: `cm-highlight cm-highlight-${highlight.color}`,
        attributes: { 'data-highlight-id': highlight.id },
      }).range(highlight.from, highlight.to),
    )

  // `true` sorts the ranges for us. Highlights may overlap and arrive in any
  // order, and `Decoration.set` throws on an unsorted input — sorting here
  // means no caller has to know that.
  return Decoration.set(ranges, true)
}

/**
 * Holds the highlight decorations and keeps them anchored across edits.
 *
 * A `StateField`, not a `ViewPlugin` — the pattern `codeSpellcheck.ts` and
 * `focusMode.ts` use does not fit here. Those derive their ranges from the
 * document itself (a syntax tree, the cursor), so they can recompute from
 * scratch whenever the view updates. These ranges come from OUTSIDE the
 * editor and cannot be recomputed from anything it holds, so they have to
 * survive edits by being mapped — which is a state-level job.
 *
 * The mapping here is CodeMirror's own `decorations.map(tr.changes)`, and it
 * is what keeps the paint correct WITHIN a keystroke. It is deliberately not
 * the same code as `highlightRanges.ts`'s `remapRanges`, which re-anchors the
 * authoritative, persisted ranges: this one runs on every transaction and
 * must be instant; that one decides what to write to disk, may drop a
 * highlight whose text is gone, and is unit-tested in isolation. They agree
 * because they map the same offsets through the same changes.
 */
const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setHighlightsEffect)) {
        return buildDecorations(effect.value, tr.state.doc.length)
      }
    }
    return decorations.map(tr.changes)
  },
  provide: (field) => EditorView.decorations.from(field),
})

/**
 * The highlight surfaces. Painted from the `--md-hl-*` tokens in
 * `app/styles/main.css`, so both themes and the soft-contrast variants are
 * handled by the token rather than repeated here.
 *
 * `box-decoration-break: clone` so a highlight spanning a wrapped line gets
 * its rounding on each visual fragment instead of one long box with rounded
 * ends miles apart. Padding is vertical-only and paired with a negative
 * margin: it fattens the band around the text without moving the text, which
 * would otherwise shift every line the moment it was highlighted.
 */
const highlightTheme = EditorView.baseTheme({
  '.cm-highlight': {
    borderRadius: '2px',
    padding: '2px 0',
    margin: '-2px 0',
    boxDecorationBreak: 'clone',
    WebkitBoxDecorationBreak: 'clone',
  },
  '.cm-highlight-amber': { backgroundColor: 'var(--md-hl-amber)' },
  '.cm-highlight-green': { backgroundColor: 'var(--md-hl-green)' },
  '.cm-highlight-blue': { backgroundColor: 'var(--md-hl-blue)' },
  '.cm-highlight-rose': { backgroundColor: 'var(--md-hl-rose)' },
})

/** Where the current selection is, in both document and screen
 * coordinates. The screen ones are captured HERE rather than measured by the
 * toolbar that uses them, because only this module has the `EditorView` that
 * can turn a document offset into a rectangle. */
export interface EditorSelectionInfo {
  from: number
  to: number
  text: string
  /** Viewport coordinates of the selection. `null` when it has scrolled out
   * of view, so the toolbar can hide rather than pin itself to a stale spot. */
  rect: { left: number; right: number; top: number; bottom: number } | null
}

function readSelection(view: EditorView): EditorSelectionInfo | null {
  const range = view.state.selection.main
  if (range.empty) return null

  const start = view.coordsAtPos(range.from)
  const end = view.coordsAtPos(range.to)
  return {
    from: range.from,
    to: range.to,
    text: view.state.sliceDoc(range.from, range.to),
    rect:
      start === null || end === null
        ? null
        : {
            left: Math.min(start.left, end.left),
            right: Math.max(start.right, end.right),
            top: Math.min(start.top, end.top),
            bottom: Math.max(start.bottom, end.bottom),
          },
  }
}

/**
 * Reports selections and clicks on highlights back out of the editor.
 *
 * Separate from `highlightExtension` above so painting works with no
 * handlers attached — `useCodeMirror` builds this one with callbacks into
 * `model/highlights.ts`, and a test or a future read-only view can mount the
 * decorations alone.
 *
 * The click handler reads `data-highlight-id` off the DOM rather than
 * resolving the click position against the range set: a decoration's own
 * element is the most direct answer to "which highlight did I click", and it
 * gets overlap right for free (the innermost mark is the innermost element),
 * where a position lookup would need `highlightAt`'s tie-break repeated here.
 */
export function highlightInteraction(handlers: {
  onSelection: (info: EditorSelectionInfo | null) => void
  onHighlightClick: (id: string) => void
}): Extension {
  return [
    EditorView.updateListener.of((update) => {
      // Geometry moves without the selection changing — scrolling, or a
      // resize that rewraps the line the selection is on. The toolbar is
      // positioned from that geometry, so it has to hear about those too.
      if (!update.selectionSet && !update.docChanged && !update.geometryChanged) return
      handlers.onSelection(readSelection(update.view))
    }),
    EditorView.domEventHandlers({
      mousedown(event) {
        const target = event.target
        if (!(target instanceof HTMLElement)) return false
        const marked = target.closest('[data-highlight-id]')
        const id = marked?.getAttribute('data-highlight-id')
        if (id === null || id === undefined) return false
        handlers.onHighlightClick(id)
        // Not handled: the click should still place the caret. Opening the
        // popover is additional to normal editing, not instead of it.
        return false
      },
    }),
  ]
}

export const highlightExtension: Extension = [highlightField, highlightTheme]

import { Transaction } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

/**
 * GFM task-list checkbox toggling — the source-editing half of "click a
 * rendered checkbox in the preview, flip `- [ ]`/`- [x]` in the markdown".
 * The DOM half (mapping a click to a source line number) lives in
 * `features/preview/lib/taskCheckbox.ts`; this module never touches the
 * DOM at all, only markdown source text and (in `toggleTaskListItemAt`)
 * a live `EditorView`.
 *
 * `TASK_ITEM_PATTERN` is a deliberately looser recognizer than GFM's own
 * tokenizer (`micromark-extension-gfm-task-list-item`) — it doesn't
 * reproduce that tokenizer's "must be the first inline content of the
 * list item" state tracking, just "list marker, required space, `[ xX]`,
 * required space-or-end-of-line after". That's fine specifically because
 * this function is only ever invoked two ways: (1) from a real rendered
 * checkbox's `data-line`, which only exists on a line GFM already parsed
 * as a task item, so the pattern is guaranteed to match; (2) from a unit
 * test handing it an arbitrary line, where being slightly more permissive
 * than upstream (e.g. accepting a checkbox with nothing after it, which
 * GFM's tokenizer actually rejects) is harmless — there is no checkbox in
 * the rendered DOM for such a line, so it can never actually be clicked.
 * What it must never do is match something GFM would also never call a
 * task item — a bare `- []` (no character between the brackets) or plain
 * text with no list marker at all — and it doesn't: the character class
 * inside the brackets requires exactly one of ` `, `x`, `X`.
 *
 * `[ \t>]*` before the list marker covers both nested-list indentation
 * (any run of spaces/tabs) and blockquote nesting (`>`, any number of
 * them, each optionally followed by its own spacing) in one shot, since a
 * task item's actual leading run is always some mixture of the two —
 * `> - [ ] x` and `>   - [ ] x` and `- [ ] x` (no quote at all) are all
 * "some run of space/tab/`>` characters, then the marker".
 */
const TASK_ITEM_PATTERN = /^([ \t>]*(?:[-*+]|\d+[.)])[ \t]+)\[[ xX]\](?=[ \t]|$)/

/**
 * The 0-based offset, within `lineText`, of the single character between
 * `[` and `]` — the one character an edit ever needs to touch. Returns
 * `null` when `lineText` isn't a task-item line at all (see
 * `TASK_ITEM_PATTERN`'s doc comment above for exactly what counts).
 *
 * Kept as its own function (rather than inlined into the two callers
 * below) because both `toggleTaskListLineText` (the whole-line pure
 * transform, unit-tested directly) and `toggleTaskListItemAt` (the live
 * `EditorView` dispatch) need the *same* offset for two different
 * purposes — building a new line string, and building a minimal
 * single-character `ChangeSpec` — and computing it twice would risk the
 * two disagreeing about which character is "the mark" if this pattern
 * ever changes.
 */
function findTaskMarkOffset(lineText: string): number | null {
  const match = TASK_ITEM_PATTERN.exec(lineText)
  if (match === null) return null
  // group 1 is everything up to and including the marker's required
  // trailing space; the very next character is `[`, and the one after
  // that — group[1].length + 1 — is the mark itself.
  return match[1].length + 1
}

/** Unchecked (` `) toggles to checked (`x`, lower-case — the canonical
 * form this app writes regardless of whether the checked state being
 * replaced was `x` or `X`); anything else (a checked box, `x` or `X`)
 * toggles to unchecked (` `). There is no third state, so this is a
 * plain binary flip, not a lookup. */
function toggleMarkChar(mark: string): string {
  return mark === ' ' ? 'x' : ' '
}

/**
 * Pure single-line transform: given one line of markdown source, returns
 * the line with its task-list mark toggled, or `null` if the line has no
 * task-list mark to toggle (not a list item, a bare `- []`, or plain
 * text) — the no-op case, left for the caller to handle (both callers
 * below just return their input unchanged).
 */
export function toggleTaskListLineText(lineText: string): string | null {
  const offset = findTaskMarkOffset(lineText)
  if (offset === null) return null
  const mark = lineText[offset]
  return lineText.slice(0, offset) + toggleMarkChar(mark) + lineText.slice(offset + 1)
}

/**
 * Pure whole-document transform: toggles the task-list mark on `line`
 * (1-based, matching both CodeMirror's `doc.line(n)` numbering and the
 * `data-line` the preview pipeline stamps from `remark`/`remark-rehype`
 * `position.start.line` — see `preview/lib/rehypeDataLine.ts` — so a
 * caller holding a `data-line` value never has to convert it). A no-op
 * (returns `source` unchanged) when `line` is out of range, or when the
 * line at `line` isn't a task-item line — both are genuine "nothing to
 * toggle" cases, not errors, since `line` can be stale by the time it's
 * acted on (e.g. the document changed between a preview click firing and
 * this running).
 *
 * This is the function this module's unit tests exercise directly, as a
 * plain string-in/string-out transform — no `EditorView` needed. The live
 * editor never actually calls this one, though: see
 * `toggleTaskListItemAt` below for why the *dispatched* edit is a
 * single-character change against the live document rather than this
 * function's whole-line replacement.
 */
export function toggleTaskListItem(source: string, line: number): string {
  const lines = source.split('\n')
  if (line < 1 || line > lines.length) return source
  const toggled = toggleTaskListLineText(lines[line - 1])
  if (toggled === null) return source
  lines[line - 1] = toggled
  return lines.join('\n')
}

/**
 * The `userEvent` tag on the dispatched transaction below — a distinct,
 * never-joinable value is what makes "one click, one undo step" a
 * guarantee rather than a race against `@codemirror/commands`' `history()`
 * config. `history()` groups a transaction into the *previous* one's undo
 * entry — rather than starting a fresh one — whenever it lands within
 * `newGroupDelay` (500ms) of the last one AND its `userEvent` either
 * matches `/^(input\.type|delete)($|\.)/` or is absent entirely (an
 * un-annotated `dispatch({ changes })`, which is what a naive
 * implementation of this function would produce, counts as "absent" and
 * so is joinable by default). A user checking a box shortly after their
 * last keystroke — well within 500ms is easy to hit, e.g. clicking
 * immediately after typing — would otherwise have that click's change
 * silently folded into whatever undo group the typing was already
 * building, so a single `Mod-z` could undo the checkbox toggle *and* the
 * preceding typed text together. Tagging with a value outside that
 * joinable set sidesteps the timing question entirely: it is never
 * joinable, regardless of how soon it follows the previous edit.
 */
const TASK_TOGGLE_USER_EVENT = 'task-list.toggle'

/**
 * Applies the toggle to the *live* `EditorView` at `line` (1-based), via
 * one `dispatch` — the editor's normal document-change path (the same
 * `updateListener` a keystroke goes through, see `useCodeMirror.ts`), so
 * autosave/dirty-tracking/preview re-render all react exactly as they
 * would to a real edit, and (see `TASK_TOGGLE_USER_EVENT` above) always
 * exactly one undo step, never merged with an adjacent edit.
 *
 * Deliberately does NOT build a `toggleTaskListItem`-style whole-line
 * replacement and diff it against the document — the change here is
 * `{ from: pos, to: pos + 1, insert: <one char> }`, touching only the
 * single character between `[` and `]`. That precision is what keeps the
 * user's cursor/selection untouched: CodeMirror maps the existing
 * selection through a dispatched change automatically, but a position
 * that falls *inside* a replaced range maps to the range's edge, not to
 * its own relative offset within it. A whole-line replacement (even one
 * that happens to produce identical text outside the single toggled
 * character) would therefore be able to relocate a cursor that was
 * sitting elsewhere on that same line — e.g. mid-word, still actively
 * being edited — even though nothing at that position actually changed.
 * A single-character change has no such hazard: every position outside
 * `[pos, pos + 1)` maps to itself untouched, and even a cursor exactly at
 * `pos` maps deterministically (same-length replacement, one character
 * for one character).
 *
 * No `scrollIntoView`/`effects` beyond the change itself, and no
 * `view.focus()` (unlike the toolbar's formatting commands in
 * `formatting.ts`, which return focus to the editor for continued
 * typing) — the user just clicked in the *preview* pane, and pulling
 * focus into the editor would be a surprising side effect of that click,
 * plus a risk of scrolling the editor pane to bring the (possibly
 * off-screen) toggled line into view.
 *
 * Silently does nothing — never throws — when `line` is out of the
 * document's current range, when the state is read-only (this editor
 * never actually goes read-only today, but the check is free and this
 * function has no other way to learn that, matching the same defensive
 * check `lib/search.ts` already makes), or when the live line at `line`
 * no longer has a task mark to toggle: `line` comes from a `data-line`
 * captured at the preview's last render, so by the time a click is
 * handled the document may already have changed underneath it (an edit,
 * a document switch) — silently doing nothing is correct here, not a bug
 * to surface, since the alternative is guessing at content that no
 * longer matches what the user actually clicked on.
 */
export function toggleTaskListItemAt(view: EditorView, line: number): void {
  if (view.state.readOnly) return
  const { doc } = view.state
  if (line < 1 || line > doc.lines) return
  const docLine = doc.line(line)
  const offset = findTaskMarkOffset(docLine.text)
  if (offset === null) return
  const pos = docLine.from + offset
  view.dispatch({
    changes: { from: pos, to: pos + 1, insert: toggleMarkChar(docLine.text[offset]) },
    annotations: Transaction.userEvent.of(TASK_TOGGLE_USER_EVENT),
  })
}

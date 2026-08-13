import type { ChangeSpec, Text } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

/**
 * Tab/Shift-Tab list nesting: on a list item, Tab nests it one level deeper
 * (under the item directly above it at the same level) and Shift-Tab lifts
 * it back out, Google-Docs/Obsidian style. This module owns the whole
 * feature: a pure "plan" core (`planListIndent`/`planListOutdent`, tested
 * directly against plain document text + 1-based line numbers, same shape
 * as `taskList.ts`'s `toggleTaskListItem`) plus the thin `EditorView`-facing
 * commands (`indentListItem`/`outdentListItem`) `useCodeMirror.ts` binds to
 * `Tab`/`Shift-Tab`.
 *
 * INDENT UNIT — not a fixed number of spaces. It is the exact width of the
 * REFERENCE sibling's own marker prefix (its indentation + marker text +
 * the required space(s) after it, e.g. 2 for `"- "`, 3 for `"1. "`, 4 for
 * `"10. "`). This was verified empirically against this project's own
 * `remark`/`remark-gfm` parse pipeline (the same one `features/preview`
 * renders through): a flat 2-space indent nests a bullet child correctly,
 * but a numbered child needs exactly 3 (or however wide its own parent's
 * marker is) to be recognised as a nested list at all — 2 spaces under a
 * `"1. "` parent gets parsed as two SIBLING top-level lists instead of one
 * nested one. Matching the reference's own marker width is the one rule
 * that is correct for every marker width at once, so there is no single
 * fixed constant that would have worked for both bullet and ordered lists.
 *
 * FIRST-ITEM REFUSAL — same behaviour as Obsidian. An item is only
 * indentable if it has a list-item sibling directly above it at the SAME
 * indentation level (scanning upward, over blank lines and over
 * MORE-indented lines — another item's own children — but stopping the
 * moment a LESS-indented line or non-list content is hit). An item with no
 * such sibling (the very first item of a list, or the first child at a
 * given nesting depth) has nothing to nest under — indenting it would
 * produce a line that CommonMark can't parse as "child of the item above"
 * (there is no item above at its level), so it refuses and Tab falls
 * through to whatever ran before this feature existed (see
 * `useCodeMirror.ts`'s `completionAcceptKeymap` doc comment — nothing else
 * binds plain Tab, so refusing here means the key reaches the browser's own
 * default "move focus" behaviour, unchanged).
 *
 * ORDERED LISTS — the indented item's own number is always rewritten to
 * `1.`/`1)` (delimiter preserved, digits replaced). This was also verified
 * against this project's `remark-gfm` pipeline: an ordered item indented
 * directly under the text of the item above it (no blank line in between —
 * exactly what happens when nesting a fresh item right after typing) is
 * CommonMark-ambiguous unless its own number is 1: a list can only
 * interrupt a paragraph (here, the reference item's own text) without a
 * blank line if it starts at 1, otherwise the line is swallowed as plain
 * continuation text of that paragraph instead of starting a nested list at
 * all — a real parse bug, not a cosmetic one. Rewriting to `1.` sidesteps
 * it unconditionally. This has no visible effect on the rendered numbers
 * beyond the first item anyway: `remark` only keeps a list's `start` value
 * (from its first item) in the syntax tree, and HTML's `<ol>` auto-numbers
 * every item after that from CSS counters — the literal digits typed after
 * the first item are discarded by the parser, never rendered.
 *
 * TASK ITEMS — only ever touched by the indent/outdent shift itself
 * (inserting/removing spaces at column 0); the checkbox and its marker sit
 * entirely after the computed "content start" column and are never part of
 * any edit range, so `- [ ]`/`- [x]` always survives byte-for-byte.
 *
 * DESCENDANTS — indenting or outdenting a line also carries along every
 * immediately-following line that is more deeply indented than it (its own
 * nested content — sub-items, wrapped continuation lines), shifting each by
 * the SAME character delta as the line that "owns" it. Without this, moving
 * an item that already has children would leave those children's indent
 * stale relative to their now-moved parent, corrupting the structure. The
 * subtree ends at the first blank line or the first line whose own
 * indentation is not deeper than its owner's — see
 * `extendRangeForDescendants`.
 *
 * MULTI-LINE SELECTION — every list-item line the selection touches is
 * indented/outdented independently, each computed against the ORIGINAL
 * (pre-edit) document exactly as the single-line case is. For a selection
 * spanning a contiguous run of siblings this naturally produces one
 * coherent nested (or lifted) block in a single dispatch, because sibling
 * lines reference the same original parent chain. If ANY touched line
 * can't be classified (not a list item, not a recognised descendant of the
 * line before it, not blank) the WHOLE operation refuses rather than
 * partially applying — see the main loop in `planListIndent`/
 * `planListOutdent`.
 *
 * FENCED CODE — a plain, deliberately simple fence-line counter
 * (`isFencedCodeLine`), not the syntax tree: counting how many
 * ` ``` `/`~~~` fence-opener/closer lines precede the touched line tells
 * `planListIndent`/`planListOutdent` to refuse unconditionally the instant
 * ANY touched line sits inside an odd-numbered fence span, regardless of
 * what that line's text looks like. Kept text-only (rather than reaching
 * for `@codemirror/language`'s `syntaxTree`, the way `wikiLinkCompletion.ts`'s
 * `isInsideCode` does) specifically so the whole feature — including this
 * exclusion — stays a pure function of document text + line numbers, unit-
 * testable without constructing a real `EditorState`.
 */

const LIST_ITEM_PATTERN = /^(\s*)([-*+]|\d+[.)])(\s+)(.*)$/

interface ParsedListLine {
  indentWidth: number
  marker: string
  isOrdered: boolean
  /** Column where the item's own content (checkbox-or-text) starts —
   * indent + marker + required spacing. Deliberately excludes a task
   * checkbox (`[ ] `/`[x] `) when present: CommonMark's own required
   * nested-content column is defined by the raw list marker alone: a
   * checkbox is inline content within the item, not part of the block
   * marker, exactly why `"- [ ] one"`'s reference width is 2 (`"- "`), not
   * 6 — verified against `remark-gfm` alongside the marker-width checks
   * above. */
  contentStart: number
}

function parseListItemLine(lineText: string): ParsedListLine | null {
  const match = LIST_ITEM_PATTERN.exec(lineText)
  if (!match) return null
  const [, indent, marker, spacing] = match
  return {
    indentWidth: indent.length,
    marker,
    isOrdered: /^\d/.test(marker),
    contentStart: indent.length + marker.length + spacing.length,
  }
}

const FENCE_LINE_PATTERN = /^ {0,3}(`{3,}|~{3,})/

/** True when line `lineNumber` (1-based) sits inside an (unclosed-as-of-that-
 * line) fenced code span — an odd number of fence delimiter lines precede
 * it. See the module doc comment for why this is a plain scan rather than a
 * syntax-tree lookup. */
function isFencedCodeLine(lines: readonly string[], lineNumber: number): boolean {
  let fenceCount = 0
  for (let n = 1; n < lineNumber; n++) {
    if (FENCE_LINE_PATTERN.test(lines[n - 1])) fenceCount++
  }
  return fenceCount % 2 === 1
}

/**
 * Extends `toLine` forward, past what the cursor/selection actually
 * touched, to swallow the last touched line's own descendant subtree (see
 * the module doc comment's DESCENDANTS section) — contiguous following
 * lines strictly more indented than it, stopping at the first blank line or
 * the first line that isn't deeper. A no-op (`toLine` unchanged) when the
 * line at `toLine` isn't a list item at all — nothing to own descendants of.
 */
function extendRangeForDescendants(lines: readonly string[], toLine: number): number {
  const owner = parseListItemLine(lines[toLine - 1])
  if (!owner) return toLine
  let end = toLine
  for (let n = toLine + 1; n <= lines.length; n++) {
    const text = lines[n - 1]
    if (text.trim() === '') break
    const leading = text.length - text.trimStart().length
    if (leading <= owner.indentWidth) break
    end = n
  }
  return end
}

/** Scans upward from just above `line` for the nearest list-item sibling at
 * exactly `indentWidth` — the item `line` would nest under. Returns `null`
 * (refuse) the moment a LESS-indented list item or non-blank non-list line
 * is hit first — see the module doc comment's FIRST-ITEM REFUSAL section.
 * Lines deeper than `indentWidth` (another item's own children) and blank
 * lines are transparently skipped over. */
function findIndentReference(
  lines: readonly string[],
  line: number,
  indentWidth: number,
): ParsedListLine | null {
  for (let n = line - 1; n >= 1; n--) {
    const text = lines[n - 1]
    if (text.trim() === '') continue
    const parsed = parseListItemLine(text)
    if (!parsed) return null
    if (parsed.indentWidth === indentWidth) return parsed
    if (parsed.indentWidth < indentWidth) return null
  }
  return null
}

/** Scans upward from just above `line` for the nearest list-item ancestor
 * strictly SHALLOWER than `indentWidth` — the level `line` would outdent
 * to. `null` (refuse) when `indentWidth` is already 0 (nothing shallower
 * than top level) or no such ancestor is found before a non-list line. */
function findOutdentParentIndent(
  lines: readonly string[],
  line: number,
  indentWidth: number,
): number | null {
  if (indentWidth === 0) return null
  for (let n = line - 1; n >= 1; n--) {
    const text = lines[n - 1]
    if (text.trim() === '') continue
    const parsed = parseListItemLine(text)
    if (!parsed) return null
    if (parsed.indentWidth < indentWidth) return parsed.indentWidth
  }
  return null
}

export interface ListLineEdit {
  /** 1-based, matching `state.doc.line(n)`/`toggleTaskListItem`'s own
   * numbering. */
  line: number
  /** Spaces to insert at column 0 (indent). Undefined/0 for a pure outdent
   * or descendant-shift-only edit that needs none. */
  insertSpaces?: number
  /** Characters to remove from column 0 (outdent). Undefined/0 for indent. */
  removeSpaces?: number
  /** Ordered-marker renumbering — only ever set on indent, only for an
   * ordered item being newly nested (see the module doc comment's ORDERED
   * LISTS section). `offset`/`length` are relative to the line's own start
   * in the ORIGINAL (pre-edit) text. */
  numberRewrite?: { offset: number; length: number; text: string }
}

/**
 * Shared walk for both directions: classifies every line in
 * `[fromLine, toLine]` as either a "root" (a list item to move, computing
 * its own target independently against `lines`) or a descendant of the
 * most recent root (shifted by that root's same delta), and delegates the
 * actual per-root target lookup to `findRoot`. Returns `null` the instant
 * anything can't be classified this way, or `findRoot` refuses for any
 * root — see the module doc comment's MULTI-LINE SELECTION section for why
 * this is all-or-nothing rather than a partial application.
 */
function planListShift(
  source: string,
  fromLine: number,
  toLine: number,
  findRoot: (
    lines: readonly string[],
    line: number,
    parsed: ParsedListLine,
  ) => { delta: number; numberRewrite?: ListLineEdit['numberRewrite'] } | null,
  applyDelta: (edit: ListLineEdit, delta: number) => void,
): ListLineEdit[] | null {
  const lines = source.split('\n')
  if (fromLine < 1 || toLine > lines.length || fromLine > toLine) return null

  const effectiveToLine = extendRangeForDescendants(lines, toLine)
  for (let n = fromLine; n <= effectiveToLine; n++) {
    if (isFencedCodeLine(lines, n)) return null
  }

  const edits: ListLineEdit[] = []
  let activeRootLine: number | null = null
  let activeRootIndent = 0
  let activeRootDelta = 0

  for (let n = fromLine; n <= effectiveToLine; n++) {
    const lineText = lines[n - 1]
    const parsed = parseListItemLine(lineText)

    if (parsed && (activeRootLine === null || parsed.indentWidth <= activeRootIndent)) {
      const root = findRoot(lines, n, parsed)
      if (!root) return null
      const edit: ListLineEdit = { line: n }
      applyDelta(edit, root.delta)
      edit.numberRewrite = root.numberRewrite
      edits.push(edit)
      activeRootLine = n
      activeRootIndent = parsed.indentWidth
      activeRootDelta = root.delta
      continue
    }

    if (activeRootLine !== null) {
      const leading = lineText.length - lineText.trimStart().length
      if (leading > activeRootIndent) {
        const edit: ListLineEdit = { line: n }
        applyDelta(edit, activeRootDelta)
        edits.push(edit)
        continue
      }
    }

    if (lineText.trim() === '') continue

    return null
  }

  return edits.length > 0 ? edits : null
}

const ORDERED_RENUMBER_TARGET = '1'

/**
 * Plans an indent (Tab) of every list item touched by `[fromLine, toLine]`
 * (1-based, inclusive — pass the same line twice for a plain cursor press).
 * Returns `null` to mean "refuse, fall through" — no list item in range, a
 * first item with no sibling above, or a fenced code block anywhere in
 * range. See the module doc comment for the full design.
 */
export function planListIndent(
  source: string,
  fromLine: number,
  toLine: number,
): ListLineEdit[] | null {
  return planListShift(
    source,
    fromLine,
    toLine,
    (lines, line, parsed) => {
      const reference = findIndentReference(lines, line, parsed.indentWidth)
      if (!reference) return null
      const delta = reference.contentStart - parsed.indentWidth
      let numberRewrite: ListLineEdit['numberRewrite']
      if (parsed.isOrdered) {
        const delimiter = parsed.marker.slice(-1)
        const newMarker = `${ORDERED_RENUMBER_TARGET}${delimiter}`
        if (parsed.marker !== newMarker) {
          numberRewrite = {
            offset: parsed.indentWidth,
            length: parsed.marker.length,
            text: newMarker,
          }
        }
      }
      return { delta, numberRewrite }
    },
    (edit, delta) => {
      edit.insertSpaces = delta
    },
  )
}

/**
 * Plans an outdent (Shift-Tab) of every list item touched by
 * `[fromLine, toLine]`. Returns `null` to refuse — no list item in range, an
 * item already at the top level with no shallower ancestor to rejoin, or a
 * fenced code block anywhere in range.
 */
export function planListOutdent(
  source: string,
  fromLine: number,
  toLine: number,
): ListLineEdit[] | null {
  return planListShift(
    source,
    fromLine,
    toLine,
    (lines, line, parsed) => {
      const parentIndent = findOutdentParentIndent(lines, line, parsed.indentWidth)
      if (parentIndent === null) return null
      return { delta: parsed.indentWidth - parentIndent }
    },
    (edit, delta) => {
      edit.removeSpaces = delta
    },
  )
}

/** Applies a plan to plain document text — the pure "what would the
 * document look like" half used by this module's own unit tests, mirroring
 * `toggleTaskListItem`'s "return the new full string" ergonomics. Order
 * matters per line: `numberRewrite` is applied against the line's ORIGINAL
 * (pre-shift) offsets first, then the indent/outdent shift is applied on
 * top — reversing that would make `numberRewrite`'s `offset` point into
 * newly-inserted spaces instead of the marker. */
function applyListLineEdits(source: string, edits: readonly ListLineEdit[]): string {
  const lines = source.split('\n')
  for (const edit of edits) {
    let text = lines[edit.line - 1]
    if (edit.numberRewrite) {
      const { offset, length, text: replacement } = edit.numberRewrite
      text = text.slice(0, offset) + replacement + text.slice(offset + length)
    }
    if (edit.insertSpaces) {
      text = ' '.repeat(edit.insertSpaces) + text
    }
    if (edit.removeSpaces) {
      text = text.slice(edit.removeSpaces)
    }
    lines[edit.line - 1] = text
  }
  return lines.join('\n')
}

/** Pure indent transform returning the new full document text, or `null`
 * when `planListIndent` refuses. The function this module's own unit tests
 * exercise directly. */
export function indentListLines(source: string, fromLine: number, toLine: number): string | null {
  const edits = planListIndent(source, fromLine, toLine)
  return edits ? applyListLineEdits(source, edits) : null
}

/** Pure outdent transform — same shape as `indentListLines`, backed by
 * `planListOutdent`. */
export function outdentListLines(source: string, fromLine: number, toLine: number): string | null {
  const edits = planListOutdent(source, fromLine, toLine)
  return edits ? applyListLineEdits(source, edits) : null
}

/**
 * Converts a plan into real `ChangeSpec`s against a live document, for the
 * `EditorView` commands below. Every edit is either a zero-width insertion
 * at the line's own start (`insertSpaces`), a small deletion at the line's
 * own start (`removeSpaces`), or (indent only, ordered items only) a
 * minimal replace of just the marker's digits — never a whole-line replace.
 * That precision is what keeps the cursor "with its text" rather than
 * dragged to a line edge on a dispatch that doesn't set `selection`
 * explicitly (CodeMirror maps the existing selection through exactly these
 * narrow ranges) — the same reasoning `taskList.ts`'s own doc comment on
 * `toggleTaskListItemAt` spells out for why THAT function edits a single
 * character rather than diffing whole lines.
 *
 * Per line, `numberRewrite` (when present) is pushed before the
 * `insertSpaces` insertion, and edits are visited in ascending `edit.line`
 * order — together that guarantees the returned array is already in the
 * ascending-position order `state.changes` requires. This matters
 * specifically for an item with NO existing indent (`indentWidth === 0`):
 * `numberRewrite` and `insertSpaces` then both start at the same `line.from`
 * — a zero-width insertion at position P is valid immediately before a
 * `[P, P+n)` replace that starts at that same P, but only in that order;
 * pushing them the other way round would insert the new spaces AFTER the
 * rewritten marker instead of before it.
 */
function toChangeSpecs(doc: Text, edits: readonly ListLineEdit[]): ChangeSpec[] {
  const specs: ChangeSpec[] = []
  for (const edit of edits) {
    const line = doc.line(edit.line)
    if (edit.numberRewrite) {
      specs.push({
        from: line.from + edit.numberRewrite.offset,
        to: line.from + edit.numberRewrite.offset + edit.numberRewrite.length,
        insert: edit.numberRewrite.text,
      })
    }
    if (edit.insertSpaces) {
      specs.push({ from: line.from, insert: ' '.repeat(edit.insertSpaces) })
    }
    if (edit.removeSpaces) {
      specs.push({ from: line.from, to: line.from + edit.removeSpaces })
    }
  }
  return specs
}

/**
 * `Tab` command: indents the list item(s) touched by the primary selection
 * one level deeper. Returns `false` (CodeMirror's "didn't handle it, try
 * the next binding" signal) when `planListIndent` refuses — see
 * `completionAcceptKeymap` in `useCodeMirror.ts` for why this command is
 * registered AFTER it in that file's extension list, so an open completion
 * menu still wins the same keypress.
 */
export function indentListItem(view: EditorView): boolean {
  const { state } = view
  const { main } = state.selection
  const fromLine = state.doc.lineAt(main.from).number
  const toLine = state.doc.lineAt(main.to).number
  const edits = planListIndent(state.doc.toString(), fromLine, toLine)
  if (!edits) return false
  view.dispatch({ changes: toChangeSpecs(state.doc, edits), userEvent: 'list.indent' })
  return true
}

/** `Shift-Tab` command — same shape as `indentListItem`, backed by
 * `planListOutdent`. Nothing else in this project binds `Shift-Tab` (see
 * `useCodeMirror.ts`'s own doc comment), so there is no precedence
 * ordering to worry about here. */
export function outdentListItem(view: EditorView): boolean {
  const { state } = view
  const { main } = state.selection
  const fromLine = state.doc.lineAt(main.from).number
  const toLine = state.doc.lineAt(main.to).number
  const edits = planListOutdent(state.doc.toString(), fromLine, toLine)
  if (!edits) return false
  view.dispatch({ changes: toChangeSpecs(state.doc, edits), userEvent: 'list.outdent' })
  return true
}

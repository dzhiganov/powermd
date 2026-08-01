import { EditorSelection, type ChangeSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

/**
 * Wraps every selection range in `marker` on both sides (bold/italic/inline
 * code). Toggles the wrap back off when it's already present — either just
 * outside the selection (cursor/selection sits *inside* the wrapped text)
 * or at both ends of the selected text itself (the whole wrapped span,
 * including its markers, was selected). An empty selection inserts both
 * markers and places the cursor between them rather than wrapping nothing.
 *
 * Built on a single `state.changeByRange` + `dispatch`: every range's
 * change lands in one transaction, so this is always exactly one undo step
 * no matter how many cursors/selections are active.
 */
export function toggleWrapInline(view: EditorView, marker: string): void {
  const tr = view.state.changeByRange((range) => {
    const state = view.state
    const selected = state.sliceDoc(range.from, range.to)
    const before = state.sliceDoc(Math.max(0, range.from - marker.length), range.from)
    const after = state.sliceDoc(range.to, range.to + marker.length)

    const selectionWrapsMarkers =
      selected.length >= marker.length * 2 &&
      selected.startsWith(marker) &&
      selected.endsWith(marker)

    if (selectionWrapsMarkers) {
      const inner = selected.slice(marker.length, selected.length - marker.length)
      return {
        changes: { from: range.from, to: range.to, insert: inner },
        range: EditorSelection.range(range.from, range.from + inner.length),
      }
    }

    if (!range.empty && before === marker && after === marker) {
      return {
        changes: [
          { from: range.from - marker.length, to: range.from, insert: '' },
          { from: range.to, to: range.to + marker.length, insert: '' },
        ],
        range: EditorSelection.range(range.from - marker.length, range.to - marker.length),
      }
    }

    if (range.empty) {
      return {
        changes: { from: range.from, insert: marker + marker },
        range: EditorSelection.cursor(range.from + marker.length),
      }
    }

    return {
      changes: { from: range.from, to: range.to, insert: marker + selected + marker },
      range: EditorSelection.range(
        range.from + marker.length,
        range.from + marker.length + selected.length,
      ),
    }
  })
  view.dispatch(tr)
  view.focus()
}

const LINK_PATTERN = /^\[([^\]]*)\]\([^)]*\)$/

/**
 * Same toggle idea as `toggleWrapInline`, specialised for `[label](url)`:
 * an empty selection inserts `[](url)` with the cursor between the
 * brackets so the label can be typed first; a non-empty selection becomes
 * the link label and the `url` placeholder is pre-selected so pasting a
 * URL immediately replaces it; a selection that already is a full
 * `[label](url)` span unwraps back to just the label.
 */
export function toggleLink(view: EditorView): void {
  const tr = view.state.changeByRange((range) => {
    const state = view.state
    const selected = state.sliceDoc(range.from, range.to)
    const existing = LINK_PATTERN.exec(selected)

    if (existing) {
      const label = existing[1]
      return {
        changes: { from: range.from, to: range.to, insert: label },
        range: EditorSelection.range(range.from, range.from + label.length),
      }
    }

    if (range.empty) {
      return {
        changes: { from: range.from, insert: '[](url)' },
        range: EditorSelection.cursor(range.from + 1),
      }
    }

    const insert = `[${selected}](url)`
    const urlStart = range.from + selected.length + 3
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(urlStart, urlStart + 3),
    }
  })
  view.dispatch(tr)
  view.focus()
}

const FENCE = '```'

/** Same toggle-wrap shape as `toggleWrapInline`, but wraps in a fenced code
 * block (its own lines) instead of an inline marker. */
export function toggleCodeBlock(view: EditorView): void {
  const tr = view.state.changeByRange((range) => {
    const state = view.state
    const selected = state.sliceDoc(range.from, range.to)
    const fenced = selected.startsWith(`${FENCE}\n`) && selected.endsWith(`\n${FENCE}`)

    if (fenced) {
      const inner = selected.slice(FENCE.length + 1, selected.length - FENCE.length - 1)
      return {
        changes: { from: range.from, to: range.to, insert: inner },
        range: EditorSelection.range(range.from, range.from + inner.length),
      }
    }

    if (range.empty) {
      return {
        changes: { from: range.from, insert: `${FENCE}\n\n${FENCE}` },
        range: EditorSelection.cursor(range.from + FENCE.length + 1),
      }
    }

    const insert = `${FENCE}\n${selected}\n${FENCE}`
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(
        range.from + FENCE.length + 1,
        range.from + FENCE.length + 1 + selected.length,
      ),
    }
  })
  view.dispatch(tr)
  view.focus()
}

/**
 * Shared engine for every line-based action (lists, quote, heading):
 * replaces the whole span of lines a selection range touches with the
 * result of `transform`, in one change per range (still one transaction —
 * and therefore one undo step — across every range via `changeByRange`).
 * The new selection covers the entire transformed block, mapped through
 * the change rather than recomputed by hand.
 */
function applyToLines(view: EditorView, transform: (lines: string[]) => string[]): void {
  const tr = view.state.changeByRange((range) => {
    const state = view.state
    const startLine = state.doc.lineAt(range.from)
    const endLine = state.doc.lineAt(range.to)
    const originalLines: string[] = []
    for (let n = startLine.number; n <= endLine.number; n++) {
      originalLines.push(state.doc.line(n).text)
    }
    const nextLines = transform(originalLines)
    const changes: ChangeSpec = {
      from: startLine.from,
      to: endLine.to,
      insert: nextLines.join('\n'),
    }
    const changeSet = state.changes(changes)
    return {
      changes,
      range: EditorSelection.range(changeSet.mapPos(startLine.from), changeSet.mapPos(endLine.to)),
    }
  })
  view.dispatch(tr)
  view.focus()
}

const BULLET_PATTERN = /^(\s*)-\s(.*)$/
const NUMBERED_PATTERN = /^(\s*)\d+\.\s(.*)$/
const QUOTE_PATTERN = /^(\s*)>\s?(.*)$/
const HEADING_PATTERN = /^(\s*)#{1,6}\s(.*)$/

export function toggleBulletList(view: EditorView): void {
  applyToLines(view, (lines) => {
    const allBulleted = lines.every((line) => BULLET_PATTERN.test(line) || line.trim() === '')
    if (allBulleted) return lines.map((line) => line.replace(BULLET_PATTERN, '$1$2'))
    return lines.map((line) => (line.trim() === '' ? line : `- ${line}`))
  })
}

export function toggleNumberedList(view: EditorView): void {
  applyToLines(view, (lines) => {
    const allNumbered = lines.every((line) => NUMBERED_PATTERN.test(line) || line.trim() === '')
    if (allNumbered) return lines.map((line) => line.replace(NUMBERED_PATTERN, '$1$2'))
    let n = 1
    return lines.map((line) => {
      if (line.trim() === '') return line
      const withNumber = `${n}. ${line}`
      n += 1
      return withNumber
    })
  })
}

export function toggleQuote(view: EditorView): void {
  applyToLines(view, (lines) => {
    const allQuoted = lines.every((line) => QUOTE_PATTERN.test(line) || line.trim() === '')
    if (allQuoted) return lines.map((line) => line.replace(QUOTE_PATTERN, '$1$2'))
    return lines.map((line) => (line.trim() === '' ? line : `> ${line}`))
  })
}

const DEFAULT_HEADING_PREFIX = '## '

export function toggleHeading(view: EditorView): void {
  applyToLines(view, (lines) => {
    const allHeadings = lines.every((line) => HEADING_PATTERN.test(line) || line.trim() === '')
    if (allHeadings) return lines.map((line) => line.replace(HEADING_PATTERN, '$1$2'))
    return lines.map((line) => (line.trim() === '' ? line : `${DEFAULT_HEADING_PREFIX}${line}`))
  })
}

const TABLE_SNIPPET = '| Header | Header |\n| --- | --- |\n| Cell | Cell |'

/** Not a toggle — always inserts a fresh table skeleton at the selection,
 * replacing it if non-empty. The first header cell's text is pre-selected
 * so it can be renamed immediately. */
export function insertTable(view: EditorView): void {
  const tr = view.state.changeByRange((range) => ({
    changes: { from: range.from, to: range.to, insert: TABLE_SNIPPET },
    range: EditorSelection.range(range.from + 2, range.from + 8),
  }))
  view.dispatch(tr)
  view.focus()
}

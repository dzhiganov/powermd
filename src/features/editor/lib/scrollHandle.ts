import type { EditorView } from '@codemirror/view'

export interface EditorLineBlock {
  /** Document-relative pixel offset of the block's top edge. */
  top: number
  /** Document-relative pixel offset of the block's bottom edge. */
  bottom: number
}

/**
 * Minimal, CodeMirror-shaped-but-CodeMirror-free surface the scroll-sync
 * feature needs to translate between the editor's pixel scroll position
 * and markdown source lines. Exists so scroll-sync (and anything else
 * outside this feature) never has to import `@codemirror/view` or reach
 * into the raw `EditorView` — see ARCHITECTURE.md's boundary rules and the
 * step 5 task notes ("expose a small, explicit API... do not leak
 * internals").
 *
 * Every method here works in **scroll space** — the same coordinate space
 * as `getScroller().scrollTop` — not CodeMirror's height-map space.
 * `.cm-content` has vertical padding (see `editor/lib/theme.ts`), so
 * `view.documentPadding.top` is nonzero and the height-map's `0` sits
 * `documentPadding.top` pixels below the scroller's real `scrollTop === 0`
 * position. That conversion is CodeMirror-specific knowledge, so it's done
 * once, here, rather than leaking `documentPadding` (or any other
 * height-map detail) out to `scroll-sync`.
 */
export interface EditorScrollHandle {
  /** The element that actually scrolls (`.cm-scroller`). */
  getScroller(): HTMLElement
  /**
   * The line block (top/bottom pixels in scroll space, plus the
   * containing line's 1-based number) at the given scroll-space vertical
   * offset — i.e. directly comparable to `getScroller().scrollTop`. Backed
   * by `EditorView.lineBlockAtHeight`, which uses the view's own measured
   * line heights rather than an assumed uniform line height — wrapped
   * lines and fenced code blocks make line height non-uniform, which is
   * the whole reason to go through the view instead of doing the
   * arithmetic by hand.
   */
  lineBlockAtScrollTop(scrollTop: number): EditorLineBlock & { line: number }
  /**
   * The scroll-space top offset for a specific 1-based line number, at the
   * given fractional position (0-1) within that line's block. Line number
   * is clamped into the document's actual line range.
   */
  scrollTopForLine(line: number, fraction: number): number
}

export function createEditorScrollHandle(view: EditorView): EditorScrollHandle {
  return {
    getScroller: () => view.scrollDOM,
    lineBlockAtScrollTop(scrollTop) {
      const height = Math.max(0, scrollTop - view.documentPadding.top)
      const block = view.lineBlockAtHeight(height)
      const line = view.state.doc.lineAt(block.from).number
      return {
        top: block.top + view.documentPadding.top,
        bottom: block.bottom + view.documentPadding.top,
        line,
      }
    },
    scrollTopForLine(line, fraction) {
      const clamped = Math.min(Math.max(line, 1), view.state.doc.lines)
      const docLine = view.state.doc.line(clamped)
      const block = view.lineBlockAt(docLine.from)
      const top = block.top + fraction * (block.bottom - block.top)
      return top + view.documentPadding.top
    },
  }
}

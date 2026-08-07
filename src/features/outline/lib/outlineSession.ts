import type { PreviewScrollHandle } from '@/features/preview'
import { buildAnchorTable, clamp, lineToPreviewTop, previewTopToLine } from '@/features/scroll-sync'

export interface OutlineSession {
  /** Scrolls the preview so the given heading's source line lands at the
   * top of the viewport. */
  jumpTo: (line: number) => void
  /** Removes every listener/observer this session created; call it exactly
   * once when the session should end (leaving preview-only mode, or the
   * preview scroll handle going away). */
  teardown: () => void
}

function maxScroll(element: HTMLElement): number {
  return Math.max(0, element.scrollHeight - element.clientHeight)
}

/**
 * Tracks which heading is "currently in view" in the preview (reported via
 * `onActiveLineChange`) and scrolls the preview to a given heading on
 * demand (`jumpTo`) — both built entirely on `scroll-sync`'s existing
 * anchor table + interpolation (`buildAnchorTable`, `lineToPreviewTop`,
 * `previewTopToLine`), the same stateless functions `src/app/paneJump.ts`
 * already reuses independently of continuous scroll sync being on, rather
 * than a second line/pixel mapping.
 *
 * Deliberately does NOT cache the anchor table the way `scroll-sync/lib/
 * syncSession.ts`'s own session does: every recompute here rebuilds it
 * fresh from the live DOM. `buildAnchorTable`'s own doc comment documents
 * the one hazard a cache would reintroduce — a pane that's present but
 * still `display:none` (e.g. mid `v-show` transition right after switching
 * into preview-only mode) reads back an all-zero table that nothing except
 * a real content mutation would otherwise invalidate. Recomputing is safe
 * to do on every call here because every caller already funnels through
 * `scheduleRecompute`, which coalesces to at most once per animation frame
 * — cheap relative to that budget for realistic documents, and by
 * definition never runs before the browser's next paint, well past any
 * pending Vue DOM patch.
 */
export function createOutlineSession(
  preview: PreviewScrollHandle,
  getHeadingLines: () => number[],
  onActiveLineChange: (line: number | null) => void,
): OutlineSession {
  const scroller = preview.getScroller()
  const contentRoot = preview.getContentRoot()

  let rafHandle: number | null = null

  function recomputeActive(): void {
    rafHandle = null
    const table = buildAnchorTable(scroller, contentRoot)
    const headingLines = getHeadingLines()
    if (table.length === 0 || headingLines.length === 0) {
      onActiveLineChange(null)
      return
    }

    const currentLine = previewTopToLine(table, scroller.scrollTop)
    if (currentLine === null) {
      onActiveLineChange(null)
      return
    }

    // The last heading whose own line is at or before the (possibly
    // fractional) source line currently at the top of the viewport — i.e.
    // the heading the reader has most recently scrolled past.
    // `headingLines` is sorted ascending by its caller. Stays `null` (no
    // highlight) until the reader has scrolled to or past the first
    // heading.
    let active: number | null = null
    for (const line of headingLines) {
      if (line <= currentLine + 0.001) active = line
      else break
    }
    onActiveLineChange(active)
  }

  function scheduleRecompute(): void {
    if (rafHandle !== null) return
    rafHandle = requestAnimationFrame(recomputeActive)
  }

  function jumpTo(line: number): void {
    const table = buildAnchorTable(scroller, contentRoot)
    const top = lineToPreviewTop(table, line)
    if (top === null) return
    scroller.scrollTop = clamp(top, 0, maxScroll(scroller))
    scheduleRecompute()
  }

  // Same invalidation sources as `scroll-sync/lib/syncSession.ts`'s own
  // session: the preview's HTML is replaced wholesale on every debounced
  // render, and images inside it load asynchronously afterwards, either of
  // which can move every heading's `top`.
  const mutationObserver = new MutationObserver(scheduleRecompute)
  mutationObserver.observe(contentRoot, { childList: true, subtree: true, characterData: true })
  contentRoot.addEventListener('load', scheduleRecompute, true)
  scroller.addEventListener('scroll', scheduleRecompute, { passive: true })

  scheduleRecompute()

  function teardown(): void {
    if (rafHandle !== null) cancelAnimationFrame(rafHandle)
    mutationObserver.disconnect()
    contentRoot.removeEventListener('load', scheduleRecompute, true)
    scroller.removeEventListener('scroll', scheduleRecompute)
  }

  return { jumpTo, teardown }
}

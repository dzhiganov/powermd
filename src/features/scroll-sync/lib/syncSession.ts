import type { EditorScrollHandle } from '@/features/editor'
import type { PreviewScrollHandle } from '@/features/preview'

import { buildAnchorTable, type ScrollAnchor } from './anchorTable'
import { clamp, lineToPreviewTop, previewTopToLine } from './interpolate'

type ActiveSource = 'editor' | 'preview'

// Events that mean "the user is interacting with this pane" — used to
// decide which pane owns the next round of syncing. `scroll` is
// deliberately excluded: it fires for both user-driven and
// programmatic (our own) scrolling, so it can't tell them apart.
// `pointerenter` is deliberately excluded too: it fires on mere hover
// (e.g. resting the mouse over the passive pane while typing), which
// isn't scroll intent and would silently disable sync for that pane.
// `pointerdown` still covers scrollbar dragging.
const OWNERSHIP_EVENTS = ['pointerdown', 'wheel', 'touchstart', 'keydown', 'focusin'] as const

/**
 * Wires up bidirectional scroll sync between one editor/preview pair.
 * Returns a teardown function that removes every listener/observer this
 * created; call it exactly once when the session should end (view mode
 * leaves split, or either handle goes away).
 *
 * Feedback-loop safety: rather than a timed `isSyncing` flag (unreliable
 * once smooth scrolling / momentum is involved — a programmatic scroll's
 * `scroll` events can still be arriving well after any reasonable
 * timeout), this tracks which pane the user last *touched*
 * (`activeSource`, set by the listeners above) and a scroll handler only
 * acts when it fires on the pane that currently owns that flag. Driving
 * the passive pane's `scrollTop` still fires its `scroll` listener, but
 * that listener checks `activeSource` first and returns immediately since
 * the passive pane never holds it — so the loop has no path back to the
 * driver, independent of timing.
 */
export function createSyncSession(
  editor: EditorScrollHandle,
  preview: PreviewScrollHandle,
): () => void {
  const editorScroller = editor.getScroller()
  const previewScroller = preview.getScroller()
  const contentRoot = preview.getContentRoot()

  // Seed ownership from wherever focus already is when the session starts,
  // rather than `null`: without this, a fresh page load or a view-mode
  // round trip (`split` → `editor` → `split`) leaves sync dead until the
  // next ownership event, even though the user has been actively
  // scrolling/typing in a pane the whole time. Defaults to `'editor'` when
  // focus isn't inside either pane.
  function initialActiveSource(): ActiveSource {
    const active = document.activeElement
    if (active instanceof Node) {
      if (previewScroller.contains(active)) return 'preview'
      if (editorScroller.contains(active)) return 'editor'
    }
    return 'editor'
  }

  let activeSource: ActiveSource = initialActiveSource()

  // Cached anchor table: rebuilding it is a batch of layout reads, so it
  // must not happen on every scroll event. Invalidated (set to `null`,
  // not rebuilt eagerly) whenever the rendered preview DOM changes or an
  // image inside it finishes loading; rebuilt lazily the next time a sync
  // actually needs it.
  let anchors: ScrollAnchor[] | null = null

  function invalidateAnchors() {
    anchors = null
  }

  function getAnchors(): ScrollAnchor[] {
    if (anchors === null) {
      anchors = buildAnchorTable(previewScroller, contentRoot)
    }
    return anchors
  }

  function maxScroll(element: HTMLElement): number {
    return Math.max(0, element.scrollHeight - element.clientHeight)
  }

  function syncFromEditor() {
    const table = getAnchors()
    if (table.length === 0) return

    const editorMax = maxScroll(editorScroller)
    const previewMax = maxScroll(previewScroller)

    // The anchor table only has entries for elements CodeMirror knows a
    // source line for. Content that grows the preview past the last
    // anchor's own height (a trailing tall image, a long trailing code
    // block) has no further line to interpolate against, so
    // `lineToPreviewTop` pins to the last anchor's `top` — short of the
    // preview's real bottom. Once the editor is at its own maximum there
    // is nowhere further for it to drive from, so snap the preview to its
    // maximum directly instead of leaving that tail unreachable.
    if (editorMax > 0 && editorScroller.scrollTop >= editorMax) {
      previewScroller.scrollTop = previewMax
      return
    }

    const block = editor.lineBlockAtScrollTop(editorScroller.scrollTop)
    const blockHeight = block.bottom - block.top
    const fraction =
      blockHeight > 0 ? clamp((editorScroller.scrollTop - block.top) / blockHeight, 0, 1) : 0
    const sourceLine = block.line + fraction

    const targetTop = lineToPreviewTop(table, sourceLine)
    if (targetTop === null) return

    previewScroller.scrollTop = clamp(targetTop, 0, previewMax)
  }

  function syncFromPreview() {
    const table = getAnchors()
    if (table.length === 0) return

    const sourceLine = previewTopToLine(table, previewScroller.scrollTop)
    if (sourceLine === null) return

    const line = Math.floor(sourceLine)
    const fraction = clamp(sourceLine - line, 0, 1)
    const targetTop = editor.scrollTopForLine(line, fraction)

    editorScroller.scrollTop = clamp(targetTop, 0, maxScroll(editorScroller))
  }

  function claimEditor() {
    activeSource = 'editor'
  }
  function claimPreview() {
    activeSource = 'preview'
  }

  function onEditorScroll() {
    if (activeSource !== 'editor') return
    syncFromEditor()
  }
  function onPreviewScroll() {
    if (activeSource !== 'preview') return
    syncFromPreview()
  }

  function onContentChanged() {
    invalidateAnchors()
  }

  for (const type of OWNERSHIP_EVENTS) {
    editorScroller.addEventListener(type, claimEditor, { passive: true })
    previewScroller.addEventListener(type, claimPreview, { passive: true })
  }
  editorScroller.addEventListener('scroll', onEditorScroll, { passive: true })
  previewScroller.addEventListener('scroll', onPreviewScroll, { passive: true })

  // The preview's HTML is replaced wholesale on every debounced render
  // (see `preview/model/preview.ts`), which is exactly the kind of DOM
  // change a `MutationObserver` reports — independent of `rAF`/visibility,
  // both of which are unreliable in some embedding contexts.
  const mutationObserver = new MutationObserver(onContentChanged)
  mutationObserver.observe(contentRoot, { childList: true, subtree: true, characterData: true })

  // Images load asynchronously and change layout afterwards. `load`
  // doesn't bubble, but a capturing listener on an ancestor still
  // observes it on the way down to the `<img>` target, so one listener
  // here covers every image the preview ever renders — no per-image
  // bookkeeping needed even though the image set changes on every render.
  contentRoot.addEventListener('load', onContentChanged, true)

  return function teardown() {
    for (const type of OWNERSHIP_EVENTS) {
      editorScroller.removeEventListener(type, claimEditor)
      previewScroller.removeEventListener(type, claimPreview)
    }
    editorScroller.removeEventListener('scroll', onEditorScroll)
    previewScroller.removeEventListener('scroll', onPreviewScroll)
    contentRoot.removeEventListener('load', onContentChanged, true)
    mutationObserver.disconnect()
  }
}

import { createEvent, createStore } from 'effector'

/**
 * Minimal surface the scroll-sync feature needs from the preview pane.
 * `getScroller` is the element whose `scrollTop` drives (and is driven
 * by) sync; `getContentRoot` is the element carrying the rendered
 * `[data-line]` anchors (see `preview/lib/rehypeDataLine.ts`) that the
 * anchor table is built from. Kept as two methods rather than exposing
 * the elements as plain fields so this can't be assigned a stale
 * reference — see `ui/Preview.vue`, which always returns the live
 * template ref.
 */
export interface PreviewScrollHandle {
  getScroller(): HTMLElement
  getContentRoot(): HTMLElement
}

/** Fired once `Preview.vue`'s scroller/content elements exist. */
export const previewScrollHandleMounted = createEvent<PreviewScrollHandle>()
export const previewScrollHandleUnmounted = createEvent()

export const $previewScrollHandle = createStore<PreviewScrollHandle | null>(null)
  .on(previewScrollHandleMounted, (_, handle) => handle)
  .on(previewScrollHandleUnmounted, () => null)

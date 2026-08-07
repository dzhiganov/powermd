import { createEvent, createStore, type Store } from 'effector'

import { $html, $previewScrollHandle, type PreviewScrollHandle } from '@/features/preview'

import { parseHeadings, type Heading } from '../lib/parseHeadings'
import { createOutlineSession, type OutlineSession } from '../lib/outlineSession'

export type { Heading }

/** Every heading in the current document, in source order, parsed from the
 * rendered preview HTML (`features/preview`'s `$html`) — a pure function of
 * that string (see `parseHeadings`), so this stays correct regardless of
 * which pane is currently visible. */
export const $headings = $html.map(parseHeadings)

/** The source line of the heading currently in view in the preview, or
 * `null` when nothing is being tracked (outline not active, or the reader
 * hasn't scrolled to the first heading yet). Keyed by line, not text — see
 * `Heading`'s own doc comment for why. */
const activeLineChanged = createEvent<number | null>()
export const $activeHeadingLine = createStore<number | null>(null).on(
  activeLineChanged,
  (_, line) => line,
)

/** Fired by the outline panel (`ui/Outline.vue`) when a heading is
 * clicked; scrolls the preview to it via the live session below. */
export const headingClicked = createEvent<number>()

interface Session {
  preview: PreviewScrollHandle
  outline: OutlineSession
}

let activeSession: Session | null = null

function currentHeadingLines(): number[] {
  return $headings
    .getState()
    .map((heading) => heading.line)
    .sort((a, b) => a - b)
}

/**
 * Watches the preview scroll handle and the injected pane-visibility
 * stores, attaching an `OutlineSession` only while the preview is the
 * *sole* visible pane — mirrors `initScrollSync`'s own watch/evaluate shape
 * in `features/scroll-sync`. `showEditor`/`showPreview` are passed in
 * (rather than imported from `@/features/layout` directly) to avoid a
 * cycle: `layout/ui/AppShell.vue` already imports this feature's own
 * `Outline` panel component, so `outline` importing `layout` back would
 * create one. `src/app/wiring.ts` — the one place allowed to know both
 * features exist — supplies them, the same dependency-injection shape
 * `initTransfer`/`initDocuments` already use there. Called once from that
 * file.
 *
 * Continuous scroll sync (`features/scroll-sync`) being off does not gate
 * this: `buildAnchorTable`/`lineToPreviewTop`/`previewTopToLine` are
 * stateless functions this session calls directly, the same way
 * `src/app/paneJump.ts` already uses them independently of
 * `$scrollSyncEnabled`.
 */
export function initOutline(deps: {
  showEditor: Store<boolean>
  showPreview: Store<boolean>
}): void {
  function isOutlineActive(): boolean {
    return !deps.showEditor.getState() && deps.showPreview.getState()
  }

  function evaluate(): void {
    const preview = $previewScrollHandle.getState()
    const active = isOutlineActive()
    const handleChanged = activeSession !== null && activeSession.preview !== preview

    if (!active || handleChanged || preview === null) {
      activeSession?.outline.teardown()
      activeSession = null
      if (!active) activeLineChanged(null)
    }

    if (active && !activeSession && preview) {
      activeSession = {
        preview,
        outline: createOutlineSession(preview, currentHeadingLines, activeLineChanged),
      }
    }
  }

  $previewScrollHandle.watch(evaluate)
  deps.showEditor.watch(evaluate)
  deps.showPreview.watch(evaluate)
}

headingClicked.watch((line) => {
  activeSession?.outline.jumpTo(line)
})

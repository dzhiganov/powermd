import {
  $previewScrollHandle,
  resolveTaskCheckboxLine,
  type PreviewScrollHandle,
} from '@/features/preview'
import { taskListItemToggleRequested } from '@/features/editor'

/**
 * Wires "click a rendered GFM task-list checkbox in the preview" to the
 * editor's normal document-change path — the one place that knows both
 * `preview` (the rendered checkbox, and `resolveTaskCheckboxLine`'s
 * click -> source-line mapping) and `editor` (the live `EditorView` that
 * actually owns the markdown text, reached only through the
 * `taskListItemToggleRequested` event — see `editor/model/taskList.ts`'s
 * doc comment for why the view itself is never exposed). Neither feature
 * imports the other; this is the one place — same shape as every other
 * cross-feature link in `wiring.ts`, and structurally identical to
 * `wikiLinks.ts`'s own click-delegation wiring just above it — that
 * connects them. Called once from `wiring.ts`.
 */

function onContentClick(event: MouseEvent): void {
  const line = resolveTaskCheckboxLine(event.target)
  if (line === null) return
  taskListItemToggleRequested(line)
}

interface Attached {
  handle: PreviewScrollHandle
  teardown: () => void
}

let attached: Attached | null = null

function attach(handle: PreviewScrollHandle): Attached {
  const contentRoot = handle.getContentRoot()
  contentRoot.addEventListener('click', onContentClick)
  return {
    handle,
    teardown: () => contentRoot.removeEventListener('click', onContentClick),
  }
}

/**
 * Watches `$previewScrollHandle` and (re)attaches the click listener
 * whenever the underlying element changes — same watch/evaluate shape as
 * `wikiLinks.ts`'s `initClickHandling`/`initPaneJump`.
 */
function initClickHandling(): void {
  function evaluate(): void {
    const handle = $previewScrollHandle.getState()

    if (attached !== null && attached.handle !== handle) {
      attached.teardown()
      attached = null
    }

    if (handle && !attached) {
      attached = attach(handle)
    }
  }

  $previewScrollHandle.watch(evaluate)
}

export function initTaskListToggle(): void {
  initClickHandling()
}

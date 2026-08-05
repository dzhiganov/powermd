import { isMac } from '@/shared/lib/platform'
import { $editorScrollHandle, type EditorScrollHandle } from '@/features/editor'
import { $previewScrollHandle, type PreviewScrollHandle } from '@/features/preview'
import {
  buildAnchorTable,
  clamp,
  lineToPreviewTop,
  previewTopToLine,
  type ScrollAnchor,
} from '@/features/scroll-sync'

/**
 * Modifier-click (Cmd on macOS, Ctrl elsewhere) jumps the *other* pane to
 * the corresponding line — a one-off, explicit-action counterpart to
 * `features/scroll-sync`'s continuous scroll sync. `editor` and `preview`
 * never import each other (or `scroll-sync`); this is the one place —
 * same shape as every cross-feature link in `wiring.ts` — that knows all
 * three and connects them.
 *
 * Deliberately independent of `scroll-sync`'s `$scrollSyncEnabled`
 * (defaulted OFF) and of any `SyncSession`: `buildAnchorTable` and the
 * `lineToPreviewTop`/`previewTopToLine` interpolation it feeds
 * (`features/scroll-sync`'s public API) are plain, stateless functions —
 * nothing about them requires a continuous-sync session to exist. Each
 * jump here builds its own fresh anchor table on demand instead of reusing
 * the session's cached one (there is no session to borrow from when sync is
 * off), which is the right trade-off for an occasional click rather than a
 * per-scroll-event hot path.
 *
 * The two directions reuse the exact per-point math `lib/syncSession.ts`'s
 * `syncFromEditor`/`syncFromPreview` already use for continuous sync — just
 * evaluated at the click's coordinate instead of the pane's current
 * `scrollTop` — rather than a second mapping.
 */

const JUMP_FLASH_HOLD_MS = 600

function isJumpClick(event: MouseEvent): boolean {
  if (event.button !== 0 || event.shiftKey || event.altKey) return false
  return isMac() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
}

function maxScroll(element: HTMLElement): number {
  return Math.max(0, element.scrollHeight - element.clientHeight)
}

/** The anchor whose `line` is closest to `line` — used only to pick which
 * preview element to flash (the interpolation functions themselves don't
 * hand back an element, just a `top`/`line` number). */
function nearestAnchorLine(anchors: ScrollAnchor[], line: number): number | null {
  if (anchors.length === 0) return null
  let nearest = anchors[0]
  let bestDistance = Math.abs(nearest.line - line)
  for (const anchor of anchors) {
    const distance = Math.abs(anchor.line - line)
    if (distance < bestDistance) {
      nearest = anchor
      bestDistance = distance
    }
  }
  return nearest.line
}

// --- Preview-side flash (the editor side's is CodeMirror state — see
// `features/editor/lib/jumpFlash.ts` — so it only needs the timeout/element
// bookkeeping here, not a whole decoration system) --------------------------

let previewFlashElement: HTMLElement | null = null
let previewFlashTimeout: ReturnType<typeof setTimeout> | null = null

function flashPreviewLine(contentRoot: HTMLElement, line: number): void {
  if (previewFlashTimeout !== null) {
    clearTimeout(previewFlashTimeout)
    previewFlashTimeout = null
  }
  previewFlashElement?.classList.remove('jump-flash')
  previewFlashElement = null

  const target = contentRoot.querySelector<HTMLElement>(`[data-line="${line}"]`)
  if (!target) return

  target.classList.add('jump-flash')
  previewFlashElement = target
  previewFlashTimeout = setTimeout(() => {
    target.classList.remove('jump-flash')
    previewFlashTimeout = null
    if (previewFlashElement === target) previewFlashElement = null
  }, JUMP_FLASH_HOLD_MS)
}

// --- The two jump directions -------------------------------------------

function jumpEditorToPreview(
  editor: EditorScrollHandle,
  preview: PreviewScrollHandle,
  event: MouseEvent,
): void {
  const editorScroller = editor.getScroller()
  const previewScroller = preview.getScroller()
  const contentRoot = preview.getContentRoot()

  // Same computation `syncFromEditor` (`scroll-sync/lib/syncSession.ts`)
  // does from `editorScroller.scrollTop`, just at the click's y instead of
  // the pane's current scroll position.
  const scrollerRect = editorScroller.getBoundingClientRect()
  const clickScrollTop = event.clientY - scrollerRect.top + editorScroller.scrollTop
  const block = editor.lineBlockAtScrollTop(clickScrollTop)
  const blockHeight = block.bottom - block.top
  const fraction = blockHeight > 0 ? clamp((clickScrollTop - block.top) / blockHeight, 0, 1) : 0
  const sourceLine = block.line + fraction

  const anchors = buildAnchorTable(previewScroller, contentRoot)
  if (anchors.length === 0) return

  const targetTop = lineToPreviewTop(anchors, sourceLine)
  if (targetTop === null) return

  previewScroller.scrollTop = clamp(targetTop, 0, maxScroll(previewScroller))

  const nearestLine = nearestAnchorLine(anchors, sourceLine)
  if (nearestLine !== null) flashPreviewLine(contentRoot, nearestLine)
}

function jumpPreviewToEditor(
  editor: EditorScrollHandle,
  preview: PreviewScrollHandle,
  event: MouseEvent,
): void {
  const editorScroller = editor.getScroller()
  const previewScroller = preview.getScroller()
  const contentRoot = preview.getContentRoot()

  // Same computation `syncFromPreview` does from `previewScroller.scrollTop`
  // — see `jumpEditorToPreview` above.
  const scrollerRect = previewScroller.getBoundingClientRect()
  const clickScrollTop = event.clientY - scrollerRect.top + previewScroller.scrollTop

  const anchors = buildAnchorTable(previewScroller, contentRoot)
  if (anchors.length === 0) return

  const sourceLine = previewTopToLine(anchors, clickScrollTop)
  if (sourceLine === null) return

  const line = Math.floor(sourceLine)
  const fraction = clamp(sourceLine - line, 0, 1)
  const targetTop = editor.scrollTopForLine(line, fraction)

  editorScroller.scrollTop = clamp(targetTop, 0, maxScroll(editorScroller))
  editor.flashLine(Math.round(sourceLine))
}

// --- DOM wiring ----------------------------------------------------------

interface Attached {
  editor: EditorScrollHandle
  preview: PreviewScrollHandle
  teardown: () => void
}

let attached: Attached | null = null

function attach(editor: EditorScrollHandle, preview: PreviewScrollHandle): Attached {
  const editorScroller = editor.getScroller()
  const contentRoot = preview.getContentRoot()

  // Capture phase, on `.cm-scroller` (an ancestor of CodeMirror's own
  // `.cm-content`, where CodeMirror's single delegated `mousedown` listener
  // is registered — on `.cm-editor`, further out still). Capture always
  // runs before any bubble-phase listener anywhere in the path, so
  // `stopPropagation()` here — only when the jump modifier is actually held
  // — reliably keeps CodeMirror from placing the cursor/starting a
  // selection for *this* click, without touching normal clicks (no
  // modifier: the handler returns immediately and CodeMirror never even
  // notices this listener exists) or any keyboard binding (a different
  // event entirely).
  const onEditorMouseDown = (event: MouseEvent): void => {
    if (!isJumpClick(event)) return
    event.preventDefault()
    event.stopPropagation()
    jumpEditorToPreview(editor, preview, event)
  }

  // Plain `click`, not `mousedown`: nothing in the preview pane pre-empts
  // click the way CodeMirror pre-empts mousedown, and using `click` is what
  // lets a link's own default action (open in a new tab) stay completely
  // untouched below — a `mousedown`-time `preventDefault` would suppress
  // that default action before the browser ever gets to it.
  const onPreviewClick = (event: MouseEvent): void => {
    if (!isJumpClick(event)) return
    const target = event.target
    // A modifier-click on a link keeps its normal browser behaviour —
    // never hijacked into a pane jump.
    if (target instanceof Element && target.closest('a')) return
    event.preventDefault()
    event.stopPropagation()
    jumpPreviewToEditor(editor, preview, event)
  }

  editorScroller.addEventListener('mousedown', onEditorMouseDown, { capture: true })
  contentRoot.addEventListener('click', onPreviewClick, { capture: true })

  return {
    editor,
    preview,
    teardown: () => {
      editorScroller.removeEventListener('mousedown', onEditorMouseDown, { capture: true })
      contentRoot.removeEventListener('click', onPreviewClick, { capture: true })
    },
  }
}

/**
 * Watches both scroll handles and (re)attaches the click listeners
 * whenever both exist — mirrors `initScrollSync`'s own watch/evaluate
 * shape, minus the `$scrollSyncEnabled`/pane-visibility gating that
 * function has: the jump works regardless of the scroll-sync setting and
 * regardless of which pane is currently shown (setting a hidden pane's
 * `scrollTop` is harmless — there's simply nothing to see until it's shown
 * again). Called once from `src/app/wiring.ts`.
 */
export function initPaneJump(): void {
  function evaluate(): void {
    const editor = $editorScrollHandle.getState()
    const preview = $previewScrollHandle.getState()

    const handlesChanged =
      attached !== null && (attached.editor !== editor || attached.preview !== preview)

    if (handlesChanged || editor === null || preview === null) {
      attached?.teardown()
      attached = null
    }

    if (editor && preview && !attached) {
      attached = attach(editor, preview)
    }
  }

  $editorScrollHandle.watch(evaluate)
  $previewScrollHandle.watch(evaluate)
}

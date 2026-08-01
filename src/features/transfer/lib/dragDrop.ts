export interface DragDropHandlers {
  onDragActive: (active: boolean) => void
  onFilesDropped: (files: File[]) => void
}

function isFileDrag(event: DragEvent): boolean {
  const types = event.dataTransfer?.types
  return types !== undefined && Array.from(types).includes('Files')
}

/**
 * Installs window-level `dragover`/`dragenter`/`dragleave`/`drop`
 * listeners. Both `dragover` and `drop` must be `preventDefault`ed at the
 * *window* level, not just on some drop-zone element: the browser's
 * default action for an unhandled `drop` is to navigate the tab to the
 * dropped file, discarding whatever unsaved work is in the editor. A
 * listener scoped only to a visual drop-zone element would leave that
 * default in place for every drop that lands anywhere else in the window —
 * an easy miss, especially since the visual affordance
 * (`ui/DropOverlay.vue`) only *shows* while dragging, it isn't a
 * dedicated, precisely-bounded target the user has to hit.
 *
 * Returns an unsubscribe function. These listeners live for the app's
 * whole lifetime (installed once from `model/transfer.ts`'s `initTransfer`,
 * mirroring `initScrollSync`/`initDocuments`), so nothing in the running
 * app ever calls the returned function — but see `model/transfer.ts` for
 * why it's still wired up to run on Vite HMR teardown.
 */
export function installDropGuard(handlers: DragDropHandlers): () => void {
  // `dragenter`/`dragleave` fire once per element the pointer crosses,
  // including every descendant of whatever's under the cursor — a depth
  // counter (not a boolean) is the standard way to know the pointer has
  // *actually* left the window, rather than just moved from a parent to
  // one of its children (which fires leave-then-enter for the parent).
  let depth = 0

  function handleDragOver(event: DragEvent): void {
    if (!isFileDrag(event)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }

  function handleDragEnter(event: DragEvent): void {
    if (!isFileDrag(event)) return
    event.preventDefault()
    depth += 1
    handlers.onDragActive(true)
  }

  function handleDragLeave(event: DragEvent): void {
    if (!isFileDrag(event)) return
    depth = Math.max(0, depth - 1)
    if (depth === 0) handlers.onDragActive(false)
  }

  function handleDrop(event: DragEvent): void {
    if (!isFileDrag(event)) return
    event.preventDefault()
    depth = 0
    handlers.onDragActive(false)
    handlers.onFilesDropped(Array.from(event.dataTransfer?.files ?? []))
  }

  window.addEventListener('dragover', handleDragOver)
  window.addEventListener('dragenter', handleDragEnter)
  window.addEventListener('dragleave', handleDragLeave)
  window.addEventListener('drop', handleDrop)

  return () => {
    window.removeEventListener('dragover', handleDragOver)
    window.removeEventListener('dragenter', handleDragEnter)
    window.removeEventListener('dragleave', handleDragLeave)
    window.removeEventListener('drop', handleDrop)
  }
}

/** A single markdown document owned by the documents feature. `content` is
 * the full source text; `title` is user-editable and independent of the
 * content. Timestamps are epoch milliseconds. */
export interface MarkdownDocument {
  id: string
  title: string
  content: string
  createdAt: number
  updatedAt: number
}

/**
 * Persistence state of the active document, surfaced by the save indicator.
 *
 * - `saved`   — every change is safely written to IndexedDB.
 * - `unsaved` — there are in-memory changes not yet persisted (either the
 *   debounce window hasn't elapsed or a write is in flight). Covers "dirty"
 *   and "saving" as one state on purpose: to the user, both mean "your last
 *   keystroke is not on disk yet".
 * - `error`   — a write failed, or IndexedDB is unavailable entirely, so
 *   changes are not being persisted. Surfaced visibly rather than swallowed.
 */
export type SaveStatus = 'saved' | 'unsaved' | 'error'

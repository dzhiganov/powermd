/** Where a document was opened from, if it was pulled in from an external
 * source rather than created locally. The only current source is GitHub. */
export interface GitHubOrigin {
  owner: string
  repo: string
  branch: string
  path: string
  /** The blob sha this document's content matched on GitHub as of the last
   * open or successful commit — the optimistic-concurrency token the
   * contents API's write endpoint requires. */
  sha: string
}

/** A single markdown document owned by the documents feature. `content` is
 * the full source text; `title` is user-editable and independent of the
 * content. Timestamps are epoch milliseconds. `folderId` is `null` for a
 * root-level document, or the id of the (flat, non-nested) folder it lives
 * in — a value that doesn't resolve to a `Folder` in `$folders` is treated
 * as root by every reader, see `model/documents.ts`. `origin` is `null` for a
 * local-only document, or the GitHub location it was opened from (and can be
 * committed back to) — a malformed/future-shaped value is treated as no
 * origin by every reader, same defensiveness as `folderId`, see
 * `lib/db.ts`'s `normalizeDocument`. */
export interface MarkdownDocument {
  id: string
  title: string
  content: string
  createdAt: number
  updatedAt: number
  folderId: string | null
  origin: GitHubOrigin | null
}

/** A flat (non-nested) grouping for documents. `createdAt` is epoch
 * milliseconds; folders have no `updatedAt` — nothing about a folder
 * changes other than its name, which doesn't need its own recency
 * tracking. */
export interface Folder {
  id: string
  name: string
  createdAt: number
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

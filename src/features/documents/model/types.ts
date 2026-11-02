/**
 * Where this document's automatic one-way sync to GitHub stands. Every
 * document is a candidate for sync once a repo connection exists — this is
 * no longer "the file this one document happened to be opened from" (the
 * old per-file "Save/Commit to GitHub" model); it is "the fixed remote slot
 * this document has been assigned within the current connection", written
 * once and then never moved.
 *
 * `owner`/`repo`/`branch` identify the connection this assignment was made
 * under (see `features/github`'s `SyncConfig`) — a reconnect to a
 * *different* repo or branch makes an existing origin stale (it no longer
 * matches `features/github`'s active connection), which is treated the same
 * as "not yet assigned" rather than silently reused against the new target.
 *
 * `path` is repo-root-relative (already includes the configured sync
 * subfolder, if any): where the document's file is on GitHub. Renaming or
 * refoldering a document moves the file in the next push — the new path
 * written and the old one removed in the same commit — and only then does
 * `path` change; see `features/github/lib/pathAssignment.ts`.
 *
 * `syncedHash` is the SHA-256 hex of the UTF-8 content last successfully
 * pushed to `path` — `null` until the first successful push. Comparing the
 * document's current content hash against this is how the sync engine knows
 * which documents actually need to be included in the next commit, without
 * re-uploading everything on every cycle.
 */
export interface GitHubOrigin {
  owner: string
  repo: string
  branch: string
  path: string
  syncedHash: string | null
  /** The title and folder `path` was named after. A document whose title or
   * folder has changed since gets its file moved by the next push. Absent on
   * an origin written by an older version; the sync engine records the
   * current title and folder the first time it sees one, so only renames
   * made from then on move anything. */
  placedAs?: GitHubPlacement | null
}

export interface GitHubPlacement {
  title: string
  folderId: string | null
}

/** A single markdown document owned by the documents feature. `content` is
 * the full source text; `title` is user-editable and independent of the
 * content. Timestamps are epoch milliseconds. `folderId` is `null` for a
 * root-level document, or the id of the (flat, non-nested) folder it lives
 * in — a value that doesn't resolve to a `Folder` in `$folders` is treated
 * as root by every reader, see `model/documents.ts`. `origin` is `null` for
 * a document that has never been assigned a place in the active GitHub sync
 * (no connection yet, or the connection has since changed), or the sync slot
 * it owns — see `GitHubOrigin`'s doc comment. A malformed/future-shaped
 * value is treated as no origin by every reader, same defensiveness as
 * `folderId`, see `lib/db.ts`'s `normalizeDocument`. */
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
 * tracking. `syncDirPath` is this folder's fixed remote directory (relative
 * to the sync subfolder root) once GitHub sync has assigned one — same
 * "assigned once, never moved" reasoning as `GitHubOrigin.path` above, for
 * the same reason: renaming a folder must not relocate every document
 * inside it on GitHub. `null` until sync assigns one (no connection yet, or
 * this folder has no synced documents in it yet). */
export interface Folder {
  id: string
  name: string
  createdAt: number
  syncDirPath: string | null
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

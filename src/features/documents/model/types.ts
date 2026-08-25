import type { BookmarkColorId } from '@/shared/config/bookmarkColors'

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
 * subfolder, if any) and is FIXED forever once assigned — see
 * `features/github/lib/pathAssignment.ts`'s doc comment for the full
 * reasoning: local deletion never deletes remotely, so a file can never be
 * *moved* on GitHub (a move is delete+create there), which means renaming or
 * refoldering a document locally must never change the path it already owns
 * — doing so would leave the old path behind as an orphaned duplicate on
 * every rename.
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

/**
 * A single bookmark — a coloured, commentable marker anchored to a text
 * position within one document. Local metadata only: bookmarks are NEVER
 * written into a document's markdown `content` (see `MarkdownDocument`'s
 * own doc comment on `content` for why anything that touches the synced
 * source text is treated this carefully) — they live in their own
 * IndexedDB store (`lib/db.ts`'s `bookmarks` object store, added in the
 * v4->v5 migration) and are deleted along with their document
 * (`db.deleteDocument`'s cascade).
 *
 * `pos` is an absolute document-offset anchor (the bookmarked line's own
 * `line.from`), not a line number — see `features/editor/lib
 * /bookmarkPosition.ts`'s "ANCHOR CHOICE" doc comment for the full
 * reasoning, and its "DELETION BEHAVIOUR" comment for what happens to `pos`
 * when the bookmarked text is deleted outright (never dropped — collapses
 * to the edit point). Only ever read/written by the `editor` feature's
 * CodeMirror gutter and this feature's own persistence/CRUD; nothing else
 * needs to interpret it as a position at all.
 */
export interface Bookmark {
  id: string
  documentId: string
  pos: number
  color: BookmarkColorId
  /** User-authored note. Empty string, not optional/undefined — same
   * "always a concrete value, `''` when there's nothing to show" shape as
   * `MarkdownDocument.title`/`content`. */
  comment: string
  createdAt: number
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

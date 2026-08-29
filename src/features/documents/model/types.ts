import type { HighlightColorId } from '@/shared/config/highlightColors'

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
 * A coloured span of a document, with an optional note.
 *
 * LOCAL METADATA ONLY. A highlight is never written into the document's
 * markdown `content` — it lives in its own IndexedDB store (`lib/db.ts`'s
 * `highlights`, added in the v5->v6 migration) and is deleted with its
 * document. That is what keeps the file you sync to GitHub, export, or
 * download identical whether or not you highlight anything in it.
 *
 * `from`/`to` are absolute document offsets into `content`, not line/column.
 * The editor maps them through every edit (`features/editor/lib/
 * highlightRanges.ts`), which is a facility CodeMirror provides for offsets
 * and not for line/column pairs; storing lines would mean re-deriving the
 * span after every keystroke and getting it wrong whenever a line was split
 * or joined.
 *
 * `text` is the highlighted text as it read WHEN THE HIGHLIGHT WAS MADE. It
 * is a display cache for the side panel, not the source of truth — the panel
 * has to show every highlight in the document, including ones scrolled far
 * out of view, and `from`/`to` alone would mean holding the whole document
 * to render a list. It is refreshed whenever the range is re-anchored, so it
 * follows edits rather than going stale.
 */
export interface Highlight {
  id: string
  documentId: string
  from: number
  to: number
  color: HighlightColorId
  /** User-authored note. Empty string, not optional — the same "always a
   * concrete value" shape as `MarkdownDocument.title`/`content`. */
  note: string
  /** Cached copy of the highlighted text — see the doc comment above. */
  text: string
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

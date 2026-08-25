/**
 * Pure, framework/CodeMirror-free bookmark *ordering* logic — sorting by
 * document position and finding the next/previous bookmark relative to a
 * cursor position, both wrap-around. Lives in `shared/lib` (not
 * `features/editor`) specifically because none of it touches
 * `@codemirror/state` — the one bookmark operation that genuinely needs
 * CodeMirror types (mapping a position through a document change) is kept
 * separate, in `features/editor/lib/bookmarkPosition.ts`, so this module
 * stays importable from both `documents` (via `src/app/wiring.ts`, which
 * resolves "next"/"previous" against the live cursor) and `editor` without
 * either feature importing the other.
 *
 * Generic over any `{ id: string; pos: number }`-shaped item so callers
 * never have to construct a throwaway projection just to sort/navigate —
 * `documents`' `Bookmark` (with `documentId`/`color`/`comment`/`createdAt`)
 * satisfies this shape structurally with no adapter needed.
 */
export interface PositionedBookmark {
  id: string
  pos: number
}

/** Ascending by document position. Stable for equal positions (two
 * bookmarks can share a position transiently — e.g. both anchored to the
 * same now-deleted line, see `bookmarkPosition.ts`'s own doc comment on
 * `TrackBefore` — `Array.prototype.sort` is stable per the ES2019+ spec, so
 * their relative order here always matches insertion order rather than
 * flickering between renders). */
export function sortBookmarksByPosition<T extends PositionedBookmark>(
  bookmarks: readonly T[],
): T[] {
  return [...bookmarks].sort((a, b) => a.pos - b.pos)
}

/**
 * The bookmark whose position is just after `cursorPos`, wrapping around to
 * the first bookmark (by position) once the cursor is at or past the last
 * one — so "next" always finds *something* when at least one bookmark
 * exists, rather than dead-ending at the end of the document. `bookmarks`
 * must already be sorted (by `sortBookmarksByPosition`) — this does not
 * re-sort, so a caller can reuse one sorted array across both `next` and
 * `previous` calls without redoing the work.
 *
 * Returns `null` only when `bookmarks` is empty.
 */
export function nextBookmark<T extends PositionedBookmark>(
  sortedBookmarks: readonly T[],
  cursorPos: number,
): T | null {
  if (sortedBookmarks.length === 0) return null
  return sortedBookmarks.find((bookmark) => bookmark.pos > cursorPos) ?? sortedBookmarks[0]
}

/** Same wrap-around shape as `nextBookmark`, searching backward: the
 * bookmark just before `cursorPos`, wrapping around to the last bookmark
 * once the cursor is at or before the first one. */
export function previousBookmark<T extends PositionedBookmark>(
  sortedBookmarks: readonly T[],
  cursorPos: number,
): T | null {
  if (sortedBookmarks.length === 0) return null
  for (let i = sortedBookmarks.length - 1; i >= 0; i--) {
    if (sortedBookmarks[i].pos < cursorPos) return sortedBookmarks[i]
  }
  return sortedBookmarks[sortedBookmarks.length - 1]
}

/** Trivial, but kept as its own named function (rather than every caller
 * writing `.length`) so "how many bookmarks does this document have" reads
 * as a single, greppable concept everywhere it's used — the status bar
 * count, the popover's heading, and this module's own tests. */
export function bookmarkCount(bookmarks: readonly unknown[]): number {
  return bookmarks.length
}

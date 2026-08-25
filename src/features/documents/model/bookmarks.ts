import { combine, createEffect, createEvent, createStore, sample } from 'effector'
import { debounce } from 'patronum'

import { DEFAULT_BOOKMARK_COLOR, type BookmarkColorId } from '@/shared/config/bookmarkColors'
import { sortBookmarksByPosition } from '@/shared/lib/bookmarkOrder'

import * as db from '../lib/db'
import { createId } from '../lib/id'
import { $activeId, documentDeleteApplied } from './documents'
import type { Bookmark } from './types'

/** Debounce for persisting a REMAPPED position after a document edit — same
 * reasoning and same order of magnitude as `documents.ts`'s own
 * `AUTOSAVE_MS`: a keystroke can remap a bookmark's position on every
 * character typed, and writing to IndexedDB on every one of those would be
 * wasteful. The in-memory `$bookmarks` store (and therefore the gutter/
 * popover's own reflected position) updates IMMEDIATELY regardless — only
 * the disk write is deferred, same "immediate in-memory, debounced to disk"
 * split as `documents.ts`'s `$documents`/`$pendingSave`. */
const POSITION_REMAP_DEBOUNCE_MS = 500

// --- Public intents (fired from editor's gutter/keyboard, via
// `src/app/wiring.ts`, or from the bookmarks popover UI) ------------------

/** A gutter click (or the Mod-Shift-B keyboard binding) on a line with no
 * bookmark yet — `pos` is that line's own `line.from`. Resolved against the
 * currently active document below; a no-op if there is none (shouldn't
 * happen in practice — the editor always has an active document open — but
 * guarded rather than assumed). */
export const bookmarkAddRequested = createEvent<number>()

/** The Mod-Shift-B keyboard binding specifically — unlike
 * `bookmarkAddRequested` above (a plain "add" from a gutter click on an
 * EMPTY cell, where "empty" was already established by the gutter's own
 * DOM lookup), this has to decide for itself whether `pos` already has a
 * bookmark, since a keyboard user has no gutter DOM to have already made
 * that determination against. */
export const bookmarkToggleAtCursorRequested = createEvent<number>()

export const bookmarkCommentChanged = createEvent<{ id: string; comment: string }>()
export const bookmarkColorChanged = createEvent<{ id: string; color: BookmarkColorId }>()
/** Direct delete, no confirmation step — unlike document/folder deletion,
 * a bookmark carries no user content of its own beyond a short comment, and
 * losing one is a low-stakes, easily-redone mistake, so the extra
 * confirmation ceremony `documentDeleteRequested`/`Confirmed` goes through
 * would be more friction than protection here. */
export const bookmarkDeleteRequested = createEvent<string>()

/** The freshly re-mapped `{ id, pos }` pairs for the CURRENTLY loaded
 * document, straight from `editor`'s `bookmarkPositionsChanged` (see
 * `src/app/wiring.ts`) — ids are globally unique, so this needs no
 * `documentId` to disambiguate; it only ever updates bookmarks that already
 * exist. */
export const bookmarkPositionsRemapped = createEvent<{ id: string; pos: number }[]>()

/** Fired when a bookmark should be brought into focus in the bookmarks
 * popover (`ui/BookmarksIndicator.vue`) — either because it was just
 * created (`bookmarkAddRequested`'s own resolution below) or because its
 * gutter marker was clicked (`editor`'s `bookmarkMarkerClicked`, via
 * wiring). The popover watches this to open itself and scroll/focus the
 * matching row. */
export const bookmarkEditorOpenRequested = createEvent<string>()

/**
 * The popover's own Prev/Next buttons (`ui/BookmarksIndicator.vue`) —
 * `documents` can't fire `editor`'s `bookmarkJumpRequested` directly (this
 * feature never imports `editor`, see ARCHITECTURE.md), so this is the
 * UI-triggered counterpart of that same intent. `src/app/wiring.ts` resolves
 * BOTH this and `editor`'s keyboard-originated `bookmarkJumpRequested`
 * through the exact same logic — two events, one feature-boundary-respecting
 * shape, one behaviour.
 */
export const bookmarkNavigateRequested = createEvent<'next' | 'previous'>()

/** A row's own "Jump to this bookmark" button — same "documents can't reach
 * the live editor view directly" reasoning as `bookmarkNavigateRequested`
 * above, resolved in `src/app/wiring.ts` by looking up the bookmark's
 * current `pos` and moving the editor there. */
export const bookmarkJumpToRequested = createEvent<string>()

// --- Internal events -------------------------------------------------------

const bookmarkAdded = createEvent<Bookmark>()
const bookmarkUpdated = createEvent<Bookmark>()
const bookmarkPositionsApplied = createEvent<{ id: string; pos: number }[]>()

interface ToggleAdd {
  kind: 'add'
  documentId: string
  pos: number
}
interface ToggleRemove {
  kind: 'remove'
  id: string
}
const bookmarkToggleResolved = createEvent<ToggleAdd | ToggleRemove | null>()

// --- Helpers ---------------------------------------------------------------

function makeBookmark(documentId: string, pos: number): Bookmark {
  return {
    id: createId(),
    documentId,
    pos,
    color: DEFAULT_BOOKMARK_COLOR,
    comment: '',
    createdAt: Date.now(),
  }
}

// --- Stores ------------------------------------------------------------

/** Every bookmark, across every document — loaded once at startup
 * (`initBookmarks`, called from `src/app/wiring.ts` alongside
 * `initDocuments`), same "load everything up front, it's small" shape as
 * `documents.ts`'s own `$folders`. */
export const $bookmarks = createStore<Bookmark[]>([])

/** The active document's bookmarks, sorted by position — the shape both
 * the gutter mirror (`src/app/wiring.ts` -> `editor`'s `$bookmarkMarkers`)
 * and the popover UI actually want; neither has any use for every OTHER
 * document's bookmarks mixed in. */
export const $activeBookmarks = combine($bookmarks, $activeId, (all, activeId) =>
  activeId === null
    ? []
    : sortBookmarksByPosition(all.filter((bookmark) => bookmark.documentId === activeId)),
)

export const $activeBookmarkCount = $activeBookmarks.map((bookmarks) => bookmarks.length)

// --- Effects -----------------------------------------------------------

const loadBookmarksFx = createEffect(() => db.getAllBookmarks())
const saveBookmarkFx = createEffect((bookmark: Bookmark) => db.putBookmark(bookmark))
const saveBookmarksFx = createEffect((bookmarks: Bookmark[]) => db.putBookmarks(bookmarks))
const deleteBookmarkFx = createEffect((id: string) => db.deleteBookmark(id))

// --- Initial load --------------------------------------------------------

$bookmarks.on(loadBookmarksFx.doneData, (_, bookmarks) => bookmarks)

/** Kick off the restore. Called once from `src/app/wiring.ts`, right after
 * `initDocuments` — same "plain function called once" shape as that
 * feature's own `initDocuments`. */
export function initBookmarks(): void {
  loadBookmarksFx()
}

// --- Adding ----------------------------------------------------------------

sample({
  clock: bookmarkAddRequested,
  source: $activeId,
  filter: (activeId): activeId is string => activeId !== null,
  // `filter`'s type predicate guarantees `activeId` is non-null here;
  // effector doesn't narrow the source through `filter` into `fn`, so the
  // assertion is only satisfying the compiler — same idiom `src/app/
  // wiring.ts` already uses for `activeDocumentEdited`.
  fn: (activeId, pos) => makeBookmark(activeId as string, pos),
  target: bookmarkAdded,
})

// Newly created bookmarks open straight into the editor popover — a
// bookmark with no comment/non-default colour yet is exactly the moment the
// user is most likely to want to set one.
sample({ clock: bookmarkAdded, fn: (bookmark) => bookmark.id, target: bookmarkEditorOpenRequested })

$bookmarks.on(bookmarkAdded, (bookmarks, bookmark) => [...bookmarks, bookmark])
sample({ clock: bookmarkAdded, target: saveBookmarkFx })

// --- Keyboard toggle (Mod-Shift-B) ------------------------------------------

sample({
  clock: bookmarkToggleAtCursorRequested,
  source: { activeId: $activeId, activeBookmarks: $activeBookmarks },
  fn: ({ activeId, activeBookmarks }, pos): ToggleAdd | ToggleRemove | null => {
    if (activeId === null) return null
    const existing = activeBookmarks.find((bookmark) => bookmark.pos === pos)
    return existing
      ? { kind: 'remove', id: existing.id }
      : { kind: 'add', documentId: activeId, pos }
  },
  target: bookmarkToggleResolved,
})

sample({
  clock: bookmarkToggleResolved,
  filter: (resolved): resolved is ToggleAdd => resolved?.kind === 'add',
  // Same "effector doesn't narrow `fn` through `filter`'s type predicate"
  // caveat as `bookmarkAddRequested`'s sample above.
  fn: (resolved) => {
    const add = resolved as ToggleAdd
    return makeBookmark(add.documentId, add.pos)
  },
  target: bookmarkAdded,
})

sample({
  clock: bookmarkToggleResolved,
  filter: (resolved): resolved is ToggleRemove => resolved?.kind === 'remove',
  fn: (resolved) => (resolved as ToggleRemove).id,
  target: bookmarkDeleteRequested,
})

// --- Editing (comment / colour) ---------------------------------------------

sample({
  clock: bookmarkCommentChanged,
  source: $bookmarks,
  filter: (bookmarks, { id }) => bookmarks.some((bookmark) => bookmark.id === id),
  fn: (bookmarks, { id, comment }): Bookmark => {
    const existing = bookmarks.find((bookmark) => bookmark.id === id) as Bookmark
    return { ...existing, comment }
  },
  target: bookmarkUpdated,
})

sample({
  clock: bookmarkColorChanged,
  source: $bookmarks,
  filter: (bookmarks, { id }) => bookmarks.some((bookmark) => bookmark.id === id),
  fn: (bookmarks, { id, color }): Bookmark => {
    const existing = bookmarks.find((bookmark) => bookmark.id === id) as Bookmark
    return { ...existing, color }
  },
  target: bookmarkUpdated,
})

$bookmarks.on(bookmarkUpdated, (bookmarks, updated) =>
  bookmarks.map((bookmark) => (bookmark.id === updated.id ? updated : bookmark)),
)
sample({ clock: bookmarkUpdated, target: saveBookmarkFx })

// --- Deleting (direct, no confirmation — see `bookmarkDeleteRequested`'s
// own doc comment) -----------------------------------------------------

$bookmarks.on(bookmarkDeleteRequested, (bookmarks, id) =>
  bookmarks.filter((bookmark) => bookmark.id !== id),
)
sample({ clock: bookmarkDeleteRequested, target: deleteBookmarkFx })

// --- Deleting a document cascades to its bookmarks --------------------------
//
// `db.deleteDocument` already cascade-deletes the on-disk rows atomically
// (see that function's own doc comment) — this just reflects the same
// result into the in-memory store for THIS tab; other tabs catch up via
// `deleteMany` broadcasts below.

$bookmarks.on(documentDeleteApplied, (bookmarks, { deletedId }) =>
  bookmarks.filter((bookmark) => bookmark.documentId !== deletedId),
)

// --- Position remapping after a document edit -------------------------------
//
// Immediate in-memory update, debounced disk write — see
// `POSITION_REMAP_DEBOUNCE_MS`'s own doc comment.

sample({ clock: bookmarkPositionsRemapped, target: bookmarkPositionsApplied })

$bookmarks.on(bookmarkPositionsApplied, (bookmarks, positions) => {
  const byId = new Map(positions.map((position) => [position.id, position.pos]))
  return bookmarks.map((bookmark) =>
    byId.has(bookmark.id) ? { ...bookmark, pos: byId.get(bookmark.id) as number } : bookmark,
  )
})

const positionRemapTick = debounce(bookmarkPositionsRemapped, POSITION_REMAP_DEBOUNCE_MS)

sample({
  clock: positionRemapTick,
  source: $bookmarks,
  fn: (bookmarks, positions) => {
    const ids = new Set(positions.map((position) => position.id))
    // Reads the CURRENT (already-applied, possibly further-edited-since)
    // positions from `$bookmarks` rather than writing back the stale
    // snapshot the debounce originally armed on — same "read fresh at fire
    // time" reasoning as `documents.ts`'s own autosave tick.
    return bookmarks.filter((bookmark) => ids.has(bookmark.id))
  },
  target: saveBookmarksFx,
})

// --- Cross-tab sync ----------------------------------------------------

const bookmarkBroadcastReceived = createEvent<db.BookmarkBroadcast>()
db.subscribeToBookmarkBroadcasts((message) => bookmarkBroadcastReceived(message))

$bookmarks.on(bookmarkBroadcastReceived, (bookmarks, message) => {
  if (message.type === 'delete') {
    return bookmarks.filter((bookmark) => bookmark.id !== message.id)
  }
  if (message.type === 'deleteMany') {
    return bookmarks.filter((bookmark) => bookmark.documentId !== message.documentId)
  }
  const incoming = message.bookmark
  const existing = bookmarks.find((bookmark) => bookmark.id === incoming.id)
  if (existing === undefined) return [...bookmarks, incoming]
  return bookmarks.map((bookmark) => (bookmark.id === incoming.id ? incoming : bookmark))
})

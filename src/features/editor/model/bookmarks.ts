import { createEvent, createStore } from 'effector'

import type { BookmarkMarker } from '../lib/bookmarkGutter'

/**
 * The editor feature's own mirror of `documents`' bookmark list for the
 * CURRENTLY OPEN document — same "the owning feature keeps the data, the
 * acting feature keeps a narrow mirror" shape as `$wikiLinkDocuments` in
 * `editorEvents.ts`. `editor` never imports `documents` (see
 * `ARCHITECTURE.md`); `src/app/wiring.ts` is what resolves `documents`'
 * `$activeBookmarks` (full `Bookmark` records, with `documentId`/`comment`/
 * `createdAt` this feature has no use for) down to the `{ id, pos, color }`
 * shape `lib/bookmarkGutter.ts`'s `BookmarkMarker` actually needs, resolving
 * each bookmark's colour id to a real hex via `shared/config
 * /bookmarkColors.ts` along the way (this feature has no notion that
 * "colour ids" exist at all — it only ever paints a CSS colour string).
 */
export const bookmarksChanged = createEvent<BookmarkMarker[]>()
export const $bookmarkMarkers = createStore<BookmarkMarker[]>([]).on(
  bookmarksChanged,
  (_, markers) => markers,
)

/** A click on an empty gutter cell — `pos` is that line's own `line.from`.
 * Consumed in `src/app/wiring.ts`, which resolves it against `documents`'
 * `$activeId` to create the actual `Bookmark` record. */
export const bookmarkGutterClicked = createEvent<number>()

/** A click on an existing bookmark marker — `id` is the bookmark's id.
 * Consumed in `src/app/wiring.ts`, which opens the bookmarks popover
 * focused on this entry. */
export const bookmarkMarkerClicked = createEvent<string>()

/** Fired by the Mod-Shift-B keyboard binding (`lib/shortcuts.ts`) — `pos`
 * is the cursor line's `line.from`, same anchor shape as
 * `bookmarkGutterClicked`. Resolved in `src/app/wiring.ts` against the
 * current document's bookmark list: adds a bookmark on that line if none
 * exists there yet, removes it if one already does — the keyboard-only
 * equivalent of a gutter click, since a keyboard user has no gutter to
 * click at all. */
export const bookmarkToggleAtCursorRequested = createEvent<number>()

/** Fired by the Mod-Shift-ArrowDown/-ArrowUp keyboard bindings
 * (`lib/shortcuts.ts`) — "next"/"previous" relative to the live cursor
 * position. Resolved in `src/app/wiring.ts`, which is the only place with
 * both the current bookmark list (`documents`) and a way to read the
 * cursor/move it (`$editorScrollHandle`'s `getCursorPos`/`jumpToPos`). */
export const bookmarkJumpRequested = createEvent<'next' | 'previous'>()

/**
 * Fired from the CodeMirror `updateListener` (`lib/useCodeMirror.ts`)
 * whenever a genuine document edit (`update.docChanged`) has just remapped
 * the live marker positions (`lib/bookmarkGutter.ts`'s `bookmarkMarkersField`,
 * via `RangeSet.map`). Carries every bookmark's freshly-mapped position for
 * the document that's currently loaded — `src/app/wiring.ts` resolves the
 * target document id (from `documents`' `$activeId`, current at the moment
 * this fires) and applies/persists them.
 */
export const bookmarkPositionsChanged = createEvent<{ id: string; pos: number }[]>()

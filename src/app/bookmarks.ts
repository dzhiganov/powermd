import { sample } from 'effector'

import { bookmarkColorHex } from '@/shared/config/bookmarkColors'
import { nextBookmark, previousBookmark } from '@/shared/lib/bookmarkOrder'
import {
  bookmarksChanged,
  bookmarkGutterClicked,
  bookmarkMarkerClicked,
  bookmarkToggleAtCursorRequested as editorBookmarkToggleAtCursorRequested,
  bookmarkPositionsChanged,
  bookmarkJumpRequested as editorBookmarkJumpRequested,
  $editorScrollHandle,
  type BookmarkMarker,
} from '@/features/editor'
import {
  $activeBookmarks,
  bookmarkAddRequested,
  bookmarkToggleAtCursorRequested as documentsBookmarkToggleAtCursorRequested,
  bookmarkPositionsRemapped,
  bookmarkEditorOpenRequested,
  bookmarkNavigateRequested,
  bookmarkJumpToRequested,
  type Bookmark,
} from '@/features/documents'

/**
 * Wires the bookmarks feature's two halves together — `editor` (the
 * CodeMirror gutter, `$bookmarkMarkers`, and the keyboard bindings in
 * `lib/shortcuts.ts`) and `documents` (the actual `Bookmark` records,
 * IndexedDB persistence, and the status-bar popover UI). Neither feature
 * imports the other (see ARCHITECTURE.md); this is the one place — same
 * shape as every other cross-feature link in `wiring.ts`, and structurally
 * identical to `wikiLinks.ts`/`taskListToggle.ts` — that connects them.
 * Called once from `wiring.ts`, right after `initDocuments`/`initBookmarks`.
 *
 * NAME COLLISIONS ARE DELIBERATE — `editor`'s `bookmarkToggleAtCursorRequested`
 * (fired by the Mod-Shift-B keymap) and `documents`' event of the same name
 * (the actual add-or-remove resolution) share a name on purpose: they are
 * the two ends of one intent, exactly the "editor fires the intent,
 * documents resolves it" shape every other bookmark event in this file
 * follows. Both are imported under feature-qualified local aliases here so
 * the two are never confused with each other.
 */

function toMarker(bookmark: Bookmark): BookmarkMarker {
  return { id: bookmark.id, pos: bookmark.pos, color: bookmarkColorHex(bookmark.color) }
}

/** Moves the editor's cursor to whichever bookmark is next/previous
 * relative to the CURRENT cursor position — shared by `editor`'s
 * keyboard-triggered `bookmarkJumpRequested` and `documents`' UI-triggered
 * `bookmarkNavigateRequested` (the popover's Prev/Next buttons); see
 * `bookmarkNavigateRequested`'s own doc comment in `documents/model
 * /bookmarks.ts` for why the UI path can't fire `editor`'s event directly.
 * A silent no-op when there's no live view or no bookmarks to jump to —
 * "nothing to do" is not an error here, the editor may not have finished
 * mounting yet, or the document may genuinely have zero bookmarks. */
function resolveBookmarkJump(direction: 'next' | 'previous'): void {
  const handle = $editorScrollHandle.getState()
  if (handle === null) return
  const bookmarks = $activeBookmarks.getState()
  if (bookmarks.length === 0) return
  const cursorPos = handle.getCursorPos()
  const target =
    direction === 'next'
      ? nextBookmark(bookmarks, cursorPos)
      : previousBookmark(bookmarks, cursorPos)
  if (target !== null) handle.jumpToPos(target.pos)
}

export function initBookmarksWiring(): void {
  // --- documents -> editor: the gutter's marker mirror --------------------
  //
  // Same one-kick-then-sample shape as every other injected mirror in
  // `wiring.ts` (e.g. `wikiLinkDocumentsChanged`) — `$activeBookmarks`'
  // already-current value at this module's evaluation time needs an
  // explicit first push, since `sample`'s `clock` only reacts to LATER
  // updates. Resolves each bookmark's colour id to a real hex here — the
  // one place that knows both `documents`' colour ids and
  // `shared/config/bookmarkColors.ts`'s hex table; `editor` only ever
  // paints a plain CSS colour string (see `editor/model/bookmarks.ts`'s own
  // doc comment).
  bookmarksChanged($activeBookmarks.getState().map(toMarker))
  sample({
    source: $activeBookmarks,
    fn: (bookmarks) => bookmarks.map(toMarker),
    target: bookmarksChanged,
  })

  // --- editor -> documents: gutter/keyboard intents -> CRUD ---------------
  //
  // Every one of these is a plain payload-preserving passthrough — the
  // resolution logic (which document, does a bookmark already exist there)
  // already lives inside `documents/model/bookmarks.ts`'s own `sample`s, so
  // there is nothing left for this wiring to compute; it only has to
  // connect the two event streams.
  sample({ clock: bookmarkGutterClicked, target: bookmarkAddRequested })
  sample({ clock: bookmarkMarkerClicked, target: bookmarkEditorOpenRequested })
  sample({
    clock: editorBookmarkToggleAtCursorRequested,
    target: documentsBookmarkToggleAtCursorRequested,
  })
  sample({ clock: bookmarkPositionsChanged, target: bookmarkPositionsRemapped })

  // --- Jump to next/previous/specific bookmark -----------------------------
  //
  // Imperative (reads live store state at fire time, moves the real
  // `EditorView`) rather than a `sample`/`target` chain — same shape as
  // `src/app/taskListToggle.ts`'s own click handler, since this needs a
  // fresh read of `$editorScrollHandle`/`$activeBookmarks` at the moment of
  // the jump, not a value captured earlier.
  editorBookmarkJumpRequested.watch(resolveBookmarkJump)
  bookmarkNavigateRequested.watch(resolveBookmarkJump)

  bookmarkJumpToRequested.watch((id) => {
    const handle = $editorScrollHandle.getState()
    if (handle === null) return
    const bookmark = $activeBookmarks.getState().find((entry) => entry.id === id)
    if (bookmark !== undefined) handle.jumpToPos(bookmark.pos)
  })
}

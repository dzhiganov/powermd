import type { ChangeDesc } from '@codemirror/state'

/**
 * Pure position-mapping core for bookmarks — the one piece of bookmark
 * logic that genuinely needs a CodeMirror type (`ChangeDesc`), which is why
 * it lives here rather than alongside the CodeMirror-free ordering helpers
 * in `shared/lib/bookmarkOrder.ts`. Mirrors `taskList.ts`/`listIndent.ts`'s
 * own "pure core, unit-tested directly against real `@codemirror/state`
 * values, no live `EditorView` needed" shape.
 *
 * ANCHOR CHOICE — a bookmark's stored `pos` is the absolute document offset
 * of the START of the line it was created on (`line.from`, not a line
 * *number*). That is what "anchor to a text position, not a line number"
 * means in practice for a gutter-click feature: a gutter cell has no
 * sub-line offset of its own to anchor to (the user clicks the gutter, not
 * a character), so the line's own start position is the most specific text
 * anchor available, and — critically — it is a real absolute offset that
 * `mapPos` can carry through an edit, unlike a 1-based line number, which
 * has no notion of "the same text" at all once lines are inserted or
 * removed above it.
 *
 * DELETION BEHAVIOUR (the "decide and state what happens" requirement) —
 * `assoc: -1` in `mapPosition` below means a bookmark whose anchored text is
 * deleted outright is **never silently dropped**: it collapses to the
 * position immediately BEFORE the deleted span (mirroring `MapMode
 * .TrackBefore` on `lib/bookmarkGutter.ts`'s live `GutterMarker`, so the two
 * mapping paths — this pure one and the StateField's `RangeSet.map` — agree
 * bit-for-bit). Concretely: deleting an entire bookmarked line merges the
 * bookmark onto whatever now sits at that boundary (typically the end of
 * the previous line, or position 0 if it was the first line) rather than
 * deleting the bookmark itself. This was picked over "delete the bookmark
 * when its text is gone" because a silently vanishing bookmark is much
 * harder to notice and recover from than one that's merely pointing at an
 * unexpected place — the user can still find it (it is still in the list,
 * still counted, still reachable via next/previous) and re-point or delete
 * it deliberately.
 */
export interface PositionedBookmark {
  id: string
  pos: number
}

/** Maps every bookmark's position through one document change, biased
 * backward (`assoc: -1`) — see this module's own doc comment for why that
 * bias is the deliberate "never silently dropped" choice, not an arbitrary
 * default. Returns a fresh array; never mutates `bookmarks`. */
export function mapBookmarkPositions<T extends PositionedBookmark>(
  bookmarks: readonly T[],
  changes: ChangeDesc,
): T[] {
  return bookmarks.map((bookmark) => ({ ...bookmark, pos: changes.mapPos(bookmark.pos, -1) }))
}

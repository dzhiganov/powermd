import { ChangeSet } from '@codemirror/state'
import { describe, expect, it } from 'vitest'

import { mapBookmarkPositions } from './bookmarkPosition'

// "AAAA\nBBBB\nCCCC\n" — three 5-character lines (4 letters + `\n`), so a
// bookmark anchored at `pos: 5` (the doc-relative offset of "BBBB"'s own
// `line.from`) sits exactly on a line boundary, which is what makes the
// insert-at-the-same-offset case below meaningful to pin down rather than
// accidentally always landing strictly before/after it.
const DOC_LENGTH = 15
const BOOKMARK_ON_LINE_TWO = { id: 'b1', pos: 5 }

describe('mapBookmarkPositions', () => {
  it('insert above (before the bookmark): position shifts forward by the inserted length', () => {
    // Inserting "XXXXX\n" (6 chars) at the very start of the document — the
    // real-world "place the cursor at the end of the previous line, press
    // Enter, type a new paragraph" gesture always inserts strictly BEFORE
    // the bookmarked line's own start, exactly like this.
    const changes = ChangeSet.of({ from: 0, insert: 'XXXXXX\n' }, DOC_LENGTH)
    const [mapped] = mapBookmarkPositions([BOOKMARK_ON_LINE_TWO], changes)
    expect(mapped.pos).toBe(5 + 'XXXXXX\n'.length)
  })

  it('insert below (after the bookmark): position is unaffected', () => {
    // Inserting at the very end of the document — strictly after the
    // bookmarked line.
    const changes = ChangeSet.of({ from: DOC_LENGTH, insert: 'ZZZZ\n' }, DOC_LENGTH)
    const [mapped] = mapBookmarkPositions([BOOKMARK_ON_LINE_TWO], changes)
    expect(mapped.pos).toBe(5)
  })

  it('insert on the SAME line, after the bookmarked text starts: position is unaffected', () => {
    // Typing at the end of "BBBB" (position 9, still inside line two) must
    // not move the bookmark's anchor at the line's own start (position 5).
    const changes = ChangeSet.of({ from: 9, insert: '!' }, DOC_LENGTH)
    const [mapped] = mapBookmarkPositions([BOOKMARK_ON_LINE_TWO], changes)
    expect(mapped.pos).toBe(5)
  })

  it('insert exactly AT the bookmark position (boundary case): stays put, biased before the insertion', () => {
    // `assoc: -1` (documented on `mapBookmarkPositions`) means an insertion
    // landing exactly on the bookmark's own offset does not carry the
    // bookmark forward into the newly-inserted text — it stays anchored to
    // offset 5, which after this insertion is now the START of the
    // inserted text, not "BBBB". This is the one documented edge case where
    // the anchor does not "follow the original text" — it only matters when
    // an edit's insertion point coincides exactly with the bookmark's own
    // offset, which the primary insert-above gesture (previous line, then
    // Enter) never produces.
    const changes = ChangeSet.of({ from: 5, insert: 'YYYY\n' }, DOC_LENGTH)
    const [mapped] = mapBookmarkPositions([BOOKMARK_ON_LINE_TWO], changes)
    expect(mapped.pos).toBe(5)
  })

  it('deleting the entire bookmarked line: the bookmark is not dropped, it collapses to the start of the deletion', () => {
    // Deletes "BBBB\n" (positions 5 to 10) outright.
    const changes = ChangeSet.of({ from: 5, to: 10 }, DOC_LENGTH)
    const [mapped] = mapBookmarkPositions([BOOKMARK_ON_LINE_TWO], changes)
    // Collapses to the deletion's start (5) — after the delete, that offset
    // is now the start of what used to be line three ("CCCC").
    expect(mapped.pos).toBe(5)
  })

  it('deleting a span that straddles the bookmark position: collapses to the deletion start, not dropped', () => {
    // Deletes positions 3 to 8 — starts inside line one, ends inside line
    // two, swallowing the bookmark's own offset (5) along the way.
    const changes = ChangeSet.of({ from: 3, to: 8 }, DOC_LENGTH)
    const [mapped] = mapBookmarkPositions([BOOKMARK_ON_LINE_TWO], changes)
    expect(mapped.pos).toBe(3)
  })

  it('deleting text entirely before the bookmark shifts it back by the deleted length', () => {
    // Deletes line one ("AAAA\n", positions 0 to 5) — line two, and the
    // bookmark on it, shift back to the very start of the document.
    const changes = ChangeSet.of({ from: 0, to: 5 }, DOC_LENGTH)
    const [mapped] = mapBookmarkPositions([BOOKMARK_ON_LINE_TWO], changes)
    expect(mapped.pos).toBe(0)
  })

  it('maps multiple bookmarks independently in one pass', () => {
    // All three positions are strictly after the insertion point (0), so
    // the `assoc: -1` boundary case (see the test above) doesn't apply to
    // any of them — every position shifts forward by the same 2 characters.
    const bookmarks = [
      { id: 'a', pos: 3 },
      { id: 'b', pos: 5 },
      { id: 'c', pos: 10 },
    ]
    const changes = ChangeSet.of({ from: 0, insert: 'XX' }, DOC_LENGTH)
    const mapped = mapBookmarkPositions(bookmarks, changes)
    expect(mapped.map((b) => [b.id, b.pos])).toEqual([
      ['a', 5],
      ['b', 7],
      ['c', 12],
    ])
  })

  it('never mutates the input array', () => {
    const bookmarks = [{ id: 'a', pos: 5 }]
    const original = [...bookmarks]
    mapBookmarkPositions(bookmarks, ChangeSet.of({ from: 0, insert: 'X' }, DOC_LENGTH))
    expect(bookmarks).toEqual(original)
  })

  it('is a no-op for an empty bookmark list', () => {
    expect(mapBookmarkPositions([], ChangeSet.of({ from: 0, insert: 'X' }, DOC_LENGTH))).toEqual([])
  })
})

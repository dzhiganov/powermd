import { describe, expect, it } from 'vitest'

import {
  bookmarkCount,
  nextBookmark,
  previousBookmark,
  sortBookmarksByPosition,
} from './bookmarkOrder'

describe('sortBookmarksByPosition', () => {
  it('sorts ascending by position', () => {
    const bookmarks = [
      { id: 'c', pos: 30 },
      { id: 'a', pos: 10 },
      { id: 'b', pos: 20 },
    ]
    expect(sortBookmarksByPosition(bookmarks).map((b) => b.id)).toEqual(['a', 'b', 'c'])
  })

  it('does not mutate the input array', () => {
    const bookmarks = [
      { id: 'b', pos: 20 },
      { id: 'a', pos: 10 },
    ]
    const original = [...bookmarks]
    sortBookmarksByPosition(bookmarks)
    expect(bookmarks).toEqual(original)
  })

  it('is stable for equal positions', () => {
    const bookmarks = [
      { id: 'first', pos: 5 },
      { id: 'second', pos: 5 },
    ]
    expect(sortBookmarksByPosition(bookmarks).map((b) => b.id)).toEqual(['first', 'second'])
  })
})

describe('nextBookmark', () => {
  const sorted = [
    { id: 'a', pos: 10 },
    { id: 'b', pos: 20 },
    { id: 'c', pos: 30 },
  ]

  it('returns null when there are no bookmarks', () => {
    expect(nextBookmark([], 0)).toBeNull()
  })

  it('finds the first bookmark strictly after the cursor', () => {
    expect(nextBookmark(sorted, 0)?.id).toBe('a')
    expect(nextBookmark(sorted, 10)?.id).toBe('b')
    expect(nextBookmark(sorted, 15)?.id).toBe('b')
  })

  it('wraps around to the first bookmark once past the last one', () => {
    expect(nextBookmark(sorted, 30)?.id).toBe('a')
    expect(nextBookmark(sorted, 1000)?.id).toBe('a')
  })

  it('wraps around with a single bookmark (returns itself)', () => {
    expect(nextBookmark([{ id: 'only', pos: 5 }], 5)?.id).toBe('only')
  })
})

describe('previousBookmark', () => {
  const sorted = [
    { id: 'a', pos: 10 },
    { id: 'b', pos: 20 },
    { id: 'c', pos: 30 },
  ]

  it('returns null when there are no bookmarks', () => {
    expect(previousBookmark([], 0)).toBeNull()
  })

  it('finds the last bookmark strictly before the cursor', () => {
    expect(previousBookmark(sorted, 1000)?.id).toBe('c')
    expect(previousBookmark(sorted, 30)?.id).toBe('b')
    expect(previousBookmark(sorted, 25)?.id).toBe('b')
  })

  it('wraps around to the last bookmark once before the first one', () => {
    expect(previousBookmark(sorted, 10)?.id).toBe('c')
    expect(previousBookmark(sorted, 0)?.id).toBe('c')
  })

  it('wraps around with a single bookmark (returns itself)', () => {
    expect(previousBookmark([{ id: 'only', pos: 5 }], 5)?.id).toBe('only')
  })
})

describe('bookmarkCount', () => {
  it('counts the list', () => {
    expect(bookmarkCount([])).toBe(0)
    expect(bookmarkCount([{ id: 'a' }, { id: 'b' }])).toBe(2)
  })
})

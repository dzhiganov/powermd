import { describe, it, expect } from 'vitest'
import { ChangeSet } from '@codemirror/state'

import { remapRanges, isHighlightableRange, highlightAt } from './highlightRanges'

/** A change set over a document of `length`, applying one edit. */
function change(length: number, spec: { from: number; to?: number; insert?: string }): ChangeSet {
  return ChangeSet.of([spec], length)
}

const range = (id: string, from: number, to: number) => ({ id, from, to })

describe('remapRanges', () => {
  it('shifts a range when text is inserted before it', () => {
    // "hello world", highlight over "world" (6..11), insert 3 chars at 0.
    const result = remapRanges([range('a', 6, 11)], change(11, { from: 0, insert: 'abc' }))
    expect(result.moved).toEqual([{ id: 'a', from: 9, to: 14 }])
    expect(result.removed).toEqual([])
  })

  it('leaves a range alone when the edit is after it', () => {
    const result = remapRanges([range('a', 0, 5)], change(11, { from: 8, insert: 'x' }))
    // Not just unchanged in value — absent, so nothing is rewritten to disk.
    expect(result.moved).toEqual([])
    expect(result.removed).toEqual([])
  })

  it('extends the range when typing at its start', () => {
    // `from` leans outward (assoc -1), so the new text joins the highlight
    // instead of the highlight sliding off it.
    const result = remapRanges([range('a', 6, 11)], change(11, { from: 6, insert: 'X' }))
    expect(result.moved).toEqual([{ id: 'a', from: 6, to: 12 }])
  })

  it('extends the range when typing at its end', () => {
    const result = remapRanges([range('a', 6, 11)], change(11, { from: 11, insert: 'X' }))
    expect(result.moved).toEqual([{ id: 'a', from: 6, to: 12 }])
  })

  it('shrinks the range when text inside it is deleted', () => {
    const result = remapRanges([range('a', 0, 11)], change(11, { from: 2, to: 5 }))
    expect(result.moved).toEqual([{ id: 'a', from: 0, to: 8 }])
  })

  it('removes a range whose text is deleted entirely', () => {
    // A highlight is a span OF TEXT — with the text gone there is nothing
    // left to colour, unlike a bookmark, which marks a place.
    const result = remapRanges([range('a', 6, 11)], change(11, { from: 6, to: 11 }))
    expect(result.moved).toEqual([])
    expect(result.removed).toEqual(['a'])
  })

  it('removes a range swallowed by a larger deletion', () => {
    const result = remapRanges([range('a', 6, 11)], change(11, { from: 3, to: 11 }))
    expect(result.removed).toEqual(['a'])
  })

  it('removes every range when the whole document is replaced', () => {
    // The case plain `mapPos` gets wrong: it moves the deleted endpoints onto
    // the replacement's edges, so with `from` leaning left and `to` leaning
    // right both highlights come back as valid ranges wrapped around the new
    // text. Select all, type one character, and every highlight would
    // reattach itself to that character.
    const result = remapRanges(
      [range('a', 0, 5), range('b', 6, 11)],
      change(11, { from: 0, to: 11, insert: 'new' }),
    )
    expect(result.moved).toEqual([])
    expect(result.removed.sort()).toEqual(['a', 'b'])
  })

  it('shrinks rather than removes when a deletion only partly overlaps', () => {
    // Half of "0..10" survives, so this must not take the same path as the
    // fully-replaced case above.
    const result = remapRanges([range('a', 0, 10)], change(20, { from: 5, to: 15 }))
    expect(result.removed).toEqual([])
    expect(result.moved).toEqual([{ id: 'a', from: 0, to: 5 }])
  })

  it('removes a range replaced by typing over exactly its own text', () => {
    const result = remapRanges([range('a', 6, 11)], change(11, { from: 6, to: 11, insert: 'X' }))
    expect(result.moved).toEqual([])
    expect(result.removed).toEqual(['a'])
  })

  it('reports only the ranges that actually moved', () => {
    // Insert in the middle: 'a' (before) is untouched, 'b' (after) shifts.
    const result = remapRanges(
      [range('a', 0, 3), range('b', 8, 11)],
      change(11, { from: 5, insert: 'XY' }),
    )
    expect(result.moved).toEqual([{ id: 'b', from: 10, to: 13 }])
  })

  it('handles an empty input without touching anything', () => {
    const result = remapRanges([], change(11, { from: 0, insert: 'x' }))
    expect(result).toEqual({ moved: [], removed: [] })
  })
})

describe('isHighlightableRange', () => {
  it('accepts a real selection', () => {
    expect(isHighlightableRange(0, 5, 'hello')).toBe(true)
  })

  it('rejects a collapsed selection', () => {
    // A stray click, or a drag that ended where it started.
    expect(isHighlightableRange(4, 4, '')).toBe(false)
  })

  it('rejects an inverted range', () => {
    expect(isHighlightableRange(9, 4, 'x')).toBe(false)
  })

  it('rejects a whitespace-only selection', () => {
    // Real, but it would render as a blank row in the panel.
    expect(isHighlightableRange(0, 3, '   ')).toBe(false)
    expect(isHighlightableRange(0, 1, '\n')).toBe(false)
  })
})

describe('highlightAt', () => {
  const outer = range('outer', 0, 20)
  const inner = range('inner', 5, 10)

  it('finds the highlight containing the position', () => {
    expect(highlightAt([outer], 7)?.id).toBe('outer')
  })

  it('returns null when the position is outside every highlight', () => {
    expect(highlightAt([inner], 2)).toBeNull()
  })

  it('prefers the innermost highlight when they overlap', () => {
    // Otherwise an inner highlight could never be selected by clicking at
    // all — the outer one would always win.
    expect(highlightAt([outer, inner], 7)?.id).toBe('inner')
    // Order of the input must not change the answer.
    expect(highlightAt([inner, outer], 7)?.id).toBe('inner')
  })

  it('includes both edges', () => {
    expect(highlightAt([inner], 5)?.id).toBe('inner')
    expect(highlightAt([inner], 10)?.id).toBe('inner')
  })

  it('returns null for an empty set', () => {
    expect(highlightAt([], 5)).toBeNull()
  })
})

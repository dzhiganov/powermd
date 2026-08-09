import { describe, expect, it } from 'vitest'

import { formatMatchCount, type MatchCount } from './search'

describe('formatMatchCount', () => {
  it('reads "No results" when there are no matches', () => {
    const count: MatchCount = { total: 0, current: 0, capped: false }
    expect(formatMatchCount(count)).toBe('No results')
  })

  it('reads "N of M" once a match is the active selection', () => {
    const count: MatchCount = { total: 12, current: 3, capped: false }
    expect(formatMatchCount(count)).toBe('3 of 12')
  })

  it('reads a bare result count (no "N of") before any match is selected', () => {
    const count: MatchCount = { total: 12, current: 0, capped: false }
    expect(formatMatchCount(count)).toBe('12 results')
  })

  it('singularizes "result" for exactly one match with no active selection', () => {
    const count: MatchCount = { total: 1, current: 0, capped: false }
    expect(formatMatchCount(count)).toBe('1 result')
  })

  it('still reads "N of M" for a single match once it is selected', () => {
    const count: MatchCount = { total: 1, current: 1, capped: false }
    expect(formatMatchCount(count)).toBe('1 of 1')
  })

  it('appends "+" to the total once the scan was capped', () => {
    const count: MatchCount = { total: 999, current: 0, capped: true }
    expect(formatMatchCount(count)).toBe('999+ results')
  })

  it('appends "+" to the total in "N of M" form too', () => {
    const count: MatchCount = { total: 999, current: 5, capped: true }
    expect(formatMatchCount(count)).toBe('5 of 999+')
  })
})

import { describe, expect, it } from 'vitest'

import { formatRelativeTime } from './relativeTime'

const NOW = 1_700_000_000_000 // arbitrary fixed epoch ms

describe('formatRelativeTime', () => {
  it('reads "just now" for anything under a minute', () => {
    expect(formatRelativeTime(NOW, NOW)).toBe('just now')
    expect(formatRelativeTime(NOW - 1_000, NOW)).toBe('just now')
    expect(formatRelativeTime(NOW - 59_000, NOW)).toBe('just now')
  })

  it('formats whole minutes once a full minute has elapsed', () => {
    expect(formatRelativeTime(NOW - 60_000, NOW)).toBe('1 minute ago')
    expect(formatRelativeTime(NOW - 3 * 60_000, NOW)).toBe('3 minutes ago')
    expect(formatRelativeTime(NOW - 59 * 60_000, NOW)).toBe('59 minutes ago')
  })

  it('formats whole hours once a full hour has elapsed', () => {
    expect(formatRelativeTime(NOW - 60 * 60_000, NOW)).toBe('1 hour ago')
    expect(formatRelativeTime(NOW - 2 * 60 * 60_000, NOW)).toBe('2 hours ago')
    expect(formatRelativeTime(NOW - 23 * 60 * 60_000, NOW)).toBe('23 hours ago')
  })

  it('formats whole days once a full day has elapsed', () => {
    expect(formatRelativeTime(NOW - 24 * 60 * 60_000, NOW)).toBe('1 day ago')
    expect(formatRelativeTime(NOW - 5 * 24 * 60 * 60_000, NOW)).toBe('5 days ago')
  })

  it('floors partial units rather than rounding up early', () => {
    // 89 minutes elapsed is 1 full hour and change — must read "1 hour
    // ago", not round up to "2 hours ago".
    expect(formatRelativeTime(NOW - 89 * 60_000, NOW)).toBe('1 hour ago')
    // 1 minute 59 seconds elapsed must still read "1 minute ago".
    expect(formatRelativeTime(NOW - (60_000 + 59_000), NOW)).toBe('1 minute ago')
  })

  it('clamps a from-time in the future to "just now" rather than a negative duration', () => {
    expect(formatRelativeTime(NOW + 60_000, NOW)).toBe('just now')
  })
})

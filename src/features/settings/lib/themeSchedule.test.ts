import { describe, expect, it } from 'vitest'

import { isTimeOfDay, nextScheduleBoundary, resolveScheduledTheme } from './themeSchedule'

/** Builds a `Date` at a given hour/minute today — `resolveScheduledTheme`
 * only ever reads `getHours()`/`getMinutes()` off it, so the actual
 * year/month/day is irrelevant to every test below except the
 * `nextScheduleBoundary` ones, which care about day boundaries too. */
function at(hours: number, minutes: number): Date {
  return new Date(2024, 0, 15, hours, minutes, 0, 0)
}

describe('resolveScheduledTheme', () => {
  const LIGHT = '07:00'
  const DARK = '19:00'

  it('resolves light during the daytime window', () => {
    expect(resolveScheduledTheme(at(12, 0), LIGHT, DARK)).toBe('light')
    expect(resolveScheduledTheme(at(7, 30), LIGHT, DARK)).toBe('light')
    expect(resolveScheduledTheme(at(18, 59), LIGHT, DARK)).toBe('light')
  })

  it('resolves dark at night', () => {
    expect(resolveScheduledTheme(at(22, 0), LIGHT, DARK)).toBe('dark')
    expect(resolveScheduledTheme(at(20, 15), LIGHT, DARK)).toBe('dark')
  })

  it('resolves dark on both sides of midnight for an overnight dark window', () => {
    // 19:00 -> 07:00 is the dark window here, and it spans midnight — both
    // "just before" and "just after" midnight must resolve dark with no
    // special-casing needed by the caller.
    expect(resolveScheduledTheme(at(23, 30), LIGHT, DARK)).toBe('dark')
    expect(resolveScheduledTheme(at(0, 30), LIGHT, DARK)).toBe('dark')
    expect(resolveScheduledTheme(at(0, 0), LIGHT, DARK)).toBe('dark')
    expect(resolveScheduledTheme(at(23, 59), LIGHT, DARK)).toBe('dark')
  })

  it('also spans midnight correctly when the LIGHT window is the one that wraps', () => {
    // Light at 19:00, dark at 07:00 — the inverse configuration: now the
    // *light* arc is the one that spans midnight (19:00 -> 07:00), and the
    // *dark* arc is the plain daytime one (07:00 -> 19:00).
    const invertedLight = '19:00'
    const invertedDark = '07:00'
    expect(resolveScheduledTheme(at(23, 30), invertedLight, invertedDark)).toBe('light')
    expect(resolveScheduledTheme(at(0, 30), invertedLight, invertedDark)).toBe('light')
    expect(resolveScheduledTheme(at(12, 0), invertedLight, invertedDark)).toBe('dark')
  })

  it('resolves exactly at each boundary — the switch time itself belongs to its own side', () => {
    expect(resolveScheduledTheme(at(7, 0), LIGHT, DARK)).toBe('light')
    expect(resolveScheduledTheme(at(19, 0), LIGHT, DARK)).toBe('dark')
  })

  it('equal light/dark times always resolve dark — deterministic, never flapping', () => {
    const SAME = '10:00'
    expect(resolveScheduledTheme(at(10, 0), SAME, SAME)).toBe('dark')
    expect(resolveScheduledTheme(at(0, 0), SAME, SAME)).toBe('dark')
    expect(resolveScheduledTheme(at(15, 30), SAME, SAME)).toBe('dark')
    expect(resolveScheduledTheme(at(23, 59), SAME, SAME)).toBe('dark')
  })

  it('falls back to midnight for a malformed time string rather than throwing', () => {
    expect(() => resolveScheduledTheme(at(12, 0), 'nonsense', DARK)).not.toThrow()
  })
})

describe('nextScheduleBoundary', () => {
  const LIGHT = '07:00'
  const DARK = '19:00'

  it("picks the sooner of today's remaining light/dark times", () => {
    const boundary = nextScheduleBoundary(at(3, 0), LIGHT, DARK)
    expect(boundary.getHours()).toBe(7)
    expect(boundary.getMinutes()).toBe(0)
    expect(boundary.getDate()).toBe(15)
  })

  it("rolls over to tomorrow once both of today's times have passed", () => {
    const boundary = nextScheduleBoundary(at(20, 0), LIGHT, DARK)
    expect(boundary.getHours()).toBe(7)
    expect(boundary.getMinutes()).toBe(0)
    expect(boundary.getDate()).toBe(16)
  })

  it('never returns a time at or before "now" — always strictly in the future', () => {
    // Exactly at the dark boundary: darkTime's own candidate for today
    // equals "now" and must roll to tomorrow, not fire an immediate/zero
    // delay timer.
    const boundary = nextScheduleBoundary(at(19, 0), LIGHT, DARK)
    expect(boundary.getTime()).toBeGreaterThan(at(19, 0).getTime())
  })

  it('still advances (once per day) when light and dark times are equal', () => {
    const SAME = '10:00'
    const boundary = nextScheduleBoundary(at(10, 0), SAME, SAME)
    expect(boundary.getDate()).toBe(16)
    expect(boundary.getHours()).toBe(10)
  })
})

describe('isTimeOfDay', () => {
  it('accepts valid 24-hour HH:MM strings', () => {
    expect(isTimeOfDay('00:00')).toBe(true)
    expect(isTimeOfDay('07:05')).toBe(true)
    expect(isTimeOfDay('23:59')).toBe(true)
  })

  it('rejects malformed or out-of-range strings, and null', () => {
    expect(isTimeOfDay(null)).toBe(false)
    expect(isTimeOfDay('')).toBe(false)
    expect(isTimeOfDay('24:00')).toBe(false)
    expect(isTimeOfDay('7:00')).toBe(false)
    expect(isTimeOfDay('07:60')).toBe(false)
    expect(isTimeOfDay('not-a-time')).toBe(false)
  })
})

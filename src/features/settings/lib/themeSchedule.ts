import { THEMES, type ResolvedTheme } from '@/shared/config/theme'

/**
 * The "Schedule" theme mode's own resolution logic — a pure function of
 * (now, lightTime, darkTime), deliberately kept separate from the
 * imperative timer bookkeeping in `model/theme.ts` (which calls this on
 * every tick and reschedules itself) so the actual switching decision can
 * be unit tested directly, with no Effector store, DOM, or timer involved.
 *
 * `lightTime`/`darkTime` are `HH:MM` 24-hour strings — the exact format a
 * native `<input type="time">` produces/consumes (see `ui/SettingsModal
 * .vue`'s two time inputs) and the exact format persisted to localStorage,
 * so no conversion happens at either edge of this module.
 *
 * GEOMETRY — the two times cut the 24-hour clock into exactly two arcs: one
 * running forward from `lightTime` up to (but not including) `darkTime`
 * (assigned 'light'), the other running forward from `darkTime` up to (but
 * not including) `lightTime` (assigned 'dark'). Which arc "wraps" past
 * midnight depends only on whether `lightTime` or `darkTime` is the later
 * clock reading — the same half-open-interval check handles both orderings
 * (see `inWindow` below), so there is no separate branch for "the overnight
 * case": a light time of 07:00 and a dark time of 19:00 (the common case)
 * already makes the DARK arc the one that spans midnight (19:00 -> 24:00 ->
 * 07:00) with no special-casing at all, because it's simply everything
 * outside the non-wrapping [07:00, 19:00) light arc.
 *
 * BOUNDARIES are half-open (`>= start && < end`): the instant a switch time
 * arrives, its own side takes effect immediately — `lightTime` itself
 * resolves to 'light', `darkTime` itself resolves to 'dark'. This is an
 * arbitrary but necessary convention (a single instant cannot belong to
 * both open arcs) and is exercised directly by the "exactly at boundary"
 * tests below.
 *
 * DEGENERATE INPUT — equal `lightTime`/`darkTime` collapses the light arc
 * to zero width (`now >= X && now < X` is never true for any `now`), so
 * every instant falls through to the dark arc. The schedule therefore
 * always resolves 'dark' when the two times are equal — a fixed, stable
 * answer (never flapping, never undefined) rather than a special error
 * state, chosen because it falls out of the half-open-interval definition
 * above for free rather than needing its own rule.
 */
export function resolveScheduledTheme(
  now: Date,
  lightTime: string,
  darkTime: string,
): ResolvedTheme {
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const lightMinutes = parseTimeToMinutes(lightTime)
  const darkMinutes = parseTimeToMinutes(darkTime)
  return inWindow(nowMinutes, lightMinutes, darkMinutes) ? THEMES.light : THEMES.dark
}

/** True when `value` falls in the half-open, wrap-aware interval
 * `[start, end)` on a 1440-minute (24-hour) clock — `start <= end` is the
 * ordinary non-wrapping case, `start > end` is the case where the interval
 * itself spans midnight. Shared by `resolveScheduledTheme` above (the light
 * arc is `[lightMinutes, darkMinutes)`) and needs no separate wrap-detection
 * step: it's the same comparison either way, just which branch fires. */
function inWindow(value: number, start: number, end: number): boolean {
  return start <= end ? value >= start && value < end : value >= start || value < end
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

/** Parses an `HH:MM` string into minutes-since-midnight (0-1439). Malformed
 * input (should not occur — both storage reads in `model/theme.ts` already
 * validate against the same pattern before a value ever reaches here, see
 * `isTimeOfDay`) falls back to 0 (midnight) rather than throwing, matching
 * this codebase's general "storage helpers fail soft" convention (see
 * `shared/lib/storage.ts`). */
function parseTimeToMinutes(time: string): number {
  const match = TIME_PATTERN.exec(time)
  if (match === null) return 0
  return Number(match[1]) * 60 + Number(match[2])
}

/**
 * The next Date (strictly after `now`) at which the schedule's resolved
 * theme could change — i.e. the next occurrence of `lightTime` or
 * `darkTime`, whichever comes first. `model/theme.ts`'s live scheduler uses
 * this to set exactly one `setTimeout` at a time (recomputing and
 * rescheduling when it fires) instead of polling on an interval, so the
 * switch happens right at the boundary rather than up to a poll period
 * late.
 *
 * Both candidate times are resolved to today's occurrence first; if a
 * candidate is not strictly after `now` (already passed, or exactly now),
 * it rolls forward to tomorrow's occurrence instead — `now` itself is
 * therefore never returned, guaranteeing forward progress (and avoiding a
 * zero-delay `setTimeout` that could refire immediately).
 *
 * When `lightTime === darkTime` (see `resolveScheduledTheme`'s own
 * "DEGENERATE INPUT" note), both candidates land on the exact same instant
 * each day — this still returns that one shared instant, so the timer
 * fires once every 24 hours, recomputes (always 'dark'), and reschedules
 * for the following day's coincident instant. No flapping: the resolved
 * value never changes between firings.
 */
export function nextScheduleBoundary(now: Date, lightTime: string, darkTime: string): Date {
  const lightCandidate = nextOccurrence(now, lightTime)
  const darkCandidate = nextOccurrence(now, darkTime)
  return lightCandidate.getTime() <= darkCandidate.getTime() ? lightCandidate : darkCandidate
}

function nextOccurrence(now: Date, time: string): Date {
  const minutes = parseTimeToMinutes(time)
  const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, minutes, 0, 0)
  if (candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + 1)
  }
  return candidate
}

/** Validates a persisted/user-entered time string is a real `HH:MM` 24-hour
 * reading — the same format `<input type="time">` emits — before it's
 * trusted as a store value. Exported so `model/theme.ts`'s storage reads
 * can reuse the exact same check this module's own parsing relies on,
 * rather than a second, potentially-drifting regex. */
export function isTimeOfDay(value: string | null): value is string {
  return value !== null && TIME_PATTERN.test(value)
}

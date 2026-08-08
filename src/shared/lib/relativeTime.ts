const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** `numeric: 'always'` deliberately, over the default `'auto'` — `'auto'`
 * would render e.g. a full day ago as "yesterday", which reads naturally on
 * its own but awkwardly once composed into a sentence like "Synced
 * yesterday" (a calendar-day word next to a duration-based one), and is
 * harder to reason about at exactly-24h boundaries in a duration model that
 * otherwise measures elapsed ms, not calendar days. `'always'` keeps every
 * unit in the same "N units ago" shape. */
const relativeTimeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'always' })

/**
 * Formats how long ago `fromMs` was, relative to `nowMs`, via
 * `Intl.RelativeTimeFormat` — never hand-rolled string maths. Pure and
 * synchronous: callers own how `nowMs` advances (see
 * `@/shared/lib/useLowFrequencyTick`), so this itself needs no timer and is
 * trivial to unit test with fixed inputs.
 *
 * `fromMs` in the future (a clock skew, not something this app expects in
 * practice for a "last synced" timestamp) is treated the same as "now" —
 * clamped to a non-negative diff — rather than producing a nonsensical
 * "in -3 minutes" style result.
 */
export function formatRelativeTime(fromMs: number, nowMs: number): string {
  const diffMs = Math.max(0, nowMs - fromMs)

  // Anything under a minute reads as "just now" rather than "37 seconds
  // ago" — this is paired with a 30s-granularity clock (see
  // `useLowFrequencyTick`), so seconds-level precision here would be a lie
  // the display can't actually back up.
  if (diffMs < MINUTE_MS) return 'just now'

  if (diffMs < HOUR_MS) {
    const minutes = Math.floor(diffMs / MINUTE_MS)
    return relativeTimeFormatter.format(-minutes, 'minute')
  }

  if (diffMs < DAY_MS) {
    const hours = Math.floor(diffMs / HOUR_MS)
    return relativeTimeFormatter.format(-hours, 'hour')
  }

  const days = Math.floor(diffMs / DAY_MS)
  return relativeTimeFormatter.format(-days, 'day')
}

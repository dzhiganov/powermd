/**
 * Pure decision at the heart of automatic GitHub sync scheduling: given the
 * current time and what's known about the last sync / current schedule,
 * decide what (if anything) should happen next. Kept pure and side-effect
 * free specifically so it can be unit tested (see `schedule.test.ts`) — a
 * real multi-minute interval can't be exercised live in this app's dev
 * environment (timers there are throttled to ~1s, and waiting out a real
 * 5-minute interval isn't practical in any environment this gets verified
 * in either). `../model/sync.ts` is the only caller: it just executes
 * whatever this returns (arms/clears a `setTimeout`, or triggers the
 * existing settle-debounce path) and feeds the up-to-date `pendingTimerAt`
 * back in on the next call.
 *
 * The rule, in one sentence: at most one automatic sync per interval, but
 * never more than a short settle delay after the interval has already
 * elapsed — so a burst of edits right at/after the boundary still batches
 * into one sync rather than each edit racing to fire its own.
 */

export type ScheduleAction =
  { kind: 'sync-now' } | { kind: 'schedule-at'; at: number } | { kind: 'nothing' }

export interface ScheduleInput {
  /** Current time, epoch ms. Passed in (never read via `Date.now()`
   * internally) so this function stays pure and trivially testable. */
  now: number
  /** Epoch ms of the last successful sync (automatic or manual), or `null`
   * before the first one this session. */
  lastSyncAt: number | null
  /** The user's configured auto-sync interval, in ms. */
  intervalMs: number
  /** Whether anything has changed since `lastSyncAt` that a sync should
   * eventually cover. A coarse proxy, not a hash-diff — see `model/sync.ts`'s
   * `$dirtySinceLastSync` doc comment for why erring toward "still dirty" is
   * always safe here. */
  hasDirty: boolean
  /** The epoch ms a `schedule-at` timer is currently armed for, or `null` if
   * none is. Lets this function recognize "the correct timer is already
   * armed" and answer `nothing` instead of asking the caller to stack a
   * second one on top of it. */
  pendingTimerAt: number | null
}

export function decideSyncSchedule({
  now,
  lastSyncAt,
  intervalMs,
  hasDirty,
  pendingTimerAt,
}: ScheduleInput): ScheduleAction {
  if (!hasDirty) return { kind: 'nothing' }

  if (lastSyncAt === null || now - lastSyncAt >= intervalMs) {
    // The interval has already fully elapsed (or nothing has ever synced
    // this session, e.g. dirty documents at startup) — go through the short
    // settle window rather than firing instantly, so a burst of edits
    // arriving together still batches into one sync. Always answered the
    // same way regardless of `pendingTimerAt`: that field only ever
    // describes a `schedule-at` timer (a different, later-branch concept),
    // and the settle window itself is what the caller's debounce collapses
    // repeated "sync-now" answers into.
    return { kind: 'sync-now' }
  }

  const dueAt = lastSyncAt + intervalMs
  // A timer already armed for this exact due time (or an earlier one — e.g.
  // the interval just shrank) already covers it; answering `schedule-at`
  // again here would only stack a second, redundant timer on top of the
  // first. (A timer armed for *later* than the freshly computed `dueAt` is
  // stale in the other direction — e.g. the interval just grew — and is
  // deliberately left alone rather than pushed back out: firing a little
  // early is harmless, so replacing it isn't worth the extra churn.)
  if (pendingTimerAt !== null && pendingTimerAt <= dueAt) return { kind: 'nothing' }
  return { kind: 'schedule-at', at: dueAt }
}

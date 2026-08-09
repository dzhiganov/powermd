/**
 * Pure exponential-backoff-with-jitter calculation for `model/sync.ts`'s push
 * retry loop (`pushBatch`'s `GitHubRefConflictError` catch branch). Kept pure
 * and side-effect free specifically so it can be unit tested (see
 * `backoff.test.ts`) with a deterministic, injected source of randomness —
 * same "pure function plus unit test" shape as `schedule.ts`/
 * `decideSyncSchedule` in this same directory.
 *
 * The problem this replaces: a ref read immediately after a write can still
 * return the previous tip (GitHub's own cross-replica propagation lag, not
 * an HTTP cache — requests already opt out of that via `cache: 'no-store'`
 * in `lib/api.ts`). A short, linearly-growing retry window (the old
 * `RETRY_BACKOFF_MS * attempt`, ~0.5s/1s/1.5s, ~3s total) can burn through
 * every attempt while the read is still stale on every single one, which is
 * exactly the failure this was built to fix: "read tip X, built commit Y on
 * parent X, after 4 attempt(s))" — the read never moved in ~3s. Growing the
 * delays exponentially and widening the total window gives GitHub's
 * replicas realistic time to catch up; jitter keeps repeated retry cycles
 * (this client's own successive syncs, or several clients retried against
 * the same ref at once) from re-colliding on the same instant.
 */

/** First retry's nominal (pre-jitter) delay. */
export const BACKOFF_BASE_DELAY_MS = 500

/** Nominal delay never grows past this, however many attempts have failed. */
export const BACKOFF_MAX_DELAY_MS = 8_000

/** Jitter is purely additive — on top of the nominal delay, never subtracted
 * from it — so the total retry window has a guaranteed floor (the sum of
 * every nominal delay) regardless of what the injected `random` returns.
 * Sized so `computeBackoffDelayMs`'s attempt sequence matches this feature's
 * own worked example almost exactly: attempts 1-5 nominally wait
 * ~0.5s/1s/2s/4s/8s (doubling each time), then hold at the 8s cap. */
export const BACKOFF_JITTER_FACTOR = 0.3

/**
 * How many total attempts (the first try plus every retry) `pushBatch` makes
 * before giving up. One fewer than this many backoff delays are actually
 * waited out (a delay only happens between attempts, never after the last
 * one) — with the constants above that's 7 delays of 0.5s/1s/2s/4s/8s/8s/8s
 * nominal, ~31.5s guaranteed floor even at zero jitter, comfortably past the
 * "roughly 30s or more" target for a background sync where waiting is free.
 */
export const MAX_PUSH_ATTEMPTS = 8

/**
 * The delay to wait before retrying, given the attempt number that just
 * failed (1-based — the first attempt that can fail and retry is `1`).
 * Doubles per attempt, caps at `BACKOFF_MAX_DELAY_MS`, then adds jitter of up
 * to `BACKOFF_JITTER_FACTOR` on top (never below the nominal value).
 *
 * `random` defaults to `Math.random` in production but is always overridable
 * — `backoff.test.ts` passes a fixed function so every assertion (growth,
 * cap, jitter bounds, total window) is deterministic rather than
 * probabilistic.
 */
export function computeBackoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const nominal = Math.min(BACKOFF_BASE_DELAY_MS * 2 ** (attempt - 1), BACKOFF_MAX_DELAY_MS)
  return nominal + random() * nominal * BACKOFF_JITTER_FACTOR
}

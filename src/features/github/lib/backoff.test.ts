import { describe, expect, it } from 'vitest'

import {
  BACKOFF_BASE_DELAY_MS,
  BACKOFF_JITTER_FACTOR,
  BACKOFF_MAX_DELAY_MS,
  MAX_PUSH_ATTEMPTS,
  computeBackoffDelayMs,
} from './backoff'

/** `random` fixed at `0` isolates the nominal (pre-jitter) delay — the floor
 * every assertion below can rely on regardless of what jitter adds. */
const noJitter = (): number => 0

describe('computeBackoffDelayMs', () => {
  it('doubles the nominal delay each attempt, matching the ~0.5s/1s/2s/4s/8s worked example', () => {
    expect(computeBackoffDelayMs(1, noJitter)).toBe(500)
    expect(computeBackoffDelayMs(2, noJitter)).toBe(1_000)
    expect(computeBackoffDelayMs(3, noJitter)).toBe(2_000)
    expect(computeBackoffDelayMs(4, noJitter)).toBe(4_000)
    expect(computeBackoffDelayMs(5, noJitter)).toBe(8_000)
  })

  it('caps the nominal delay rather than continuing to double indefinitely', () => {
    // Attempt 5 already reaches the cap; every attempt after it must stay
    // pinned there, not keep growing (2^9 * 500ms would be ~256s otherwise).
    expect(computeBackoffDelayMs(6, noJitter)).toBe(BACKOFF_MAX_DELAY_MS)
    expect(computeBackoffDelayMs(7, noJitter)).toBe(BACKOFF_MAX_DELAY_MS)
    expect(computeBackoffDelayMs(10, noJitter)).toBe(BACKOFF_MAX_DELAY_MS)
  })

  it('keeps jitter within [nominal, nominal * (1 + JITTER_FACTOR)]', () => {
    const nominal = BACKOFF_BASE_DELAY_MS * 2 ** (3 - 1) // attempt 3 -> 2000ms
    const max = nominal * (1 + BACKOFF_JITTER_FACTOR)

    expect(computeBackoffDelayMs(3, () => 0)).toBe(nominal)
    expect(computeBackoffDelayMs(3, () => 1)).toBeCloseTo(max, 5)
    expect(computeBackoffDelayMs(3, () => 0.5)).toBeGreaterThan(nominal)
    expect(computeBackoffDelayMs(3, () => 0.5)).toBeLessThan(max)

    // A wide spread of random() values never escapes the documented bounds.
    for (const r of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const delay = computeBackoffDelayMs(4, () => r)
      expect(delay).toBeGreaterThanOrEqual(nominal * 2) // attempt 4's own nominal, not attempt 3's
      expect(delay).toBeLessThanOrEqual(nominal * 2 * (1 + BACKOFF_JITTER_FACTOR))
    }
  })

  it('never goes negative or produces NaN for an unexpected random() implementation', () => {
    expect(computeBackoffDelayMs(1, () => -1)).toBeGreaterThanOrEqual(0)
    expect(Number.isNaN(computeBackoffDelayMs(1, () => -1))).toBe(false)
  })

  it('sums to a guaranteed floor of "roughly 30s or more" across the full retry window, even with zero jitter', () => {
    // One delay happens between each pair of attempts, so `pushBatch`'s
    // `attempt < MAX_PUSH_ATTEMPTS` retry loop waits out this many delays
    // in the worst (real-world) case: every retry rejected as a conflict.
    let totalMs = 0
    for (let attempt = 1; attempt < MAX_PUSH_ATTEMPTS; attempt += 1) {
      totalMs += computeBackoffDelayMs(attempt, noJitter)
    }
    expect(totalMs).toBe(31_500) // 500+1000+2000+4000+8000+8000+8000, exact and deterministic
    expect(totalMs).toBeGreaterThanOrEqual(30_000)

    // Jitter can only ever push the real total higher than this floor, never
    // lower — confirms the "or more" half of "roughly 30s or more".
    let totalWithMaxJitter = 0
    for (let attempt = 1; attempt < MAX_PUSH_ATTEMPTS; attempt += 1) {
      totalWithMaxJitter += computeBackoffDelayMs(attempt, () => 1)
    }
    expect(totalWithMaxJitter).toBeGreaterThan(totalMs)
  })
})

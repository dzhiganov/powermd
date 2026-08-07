import { describe, expect, it } from 'vitest'

import { decideSyncSchedule, type ScheduleInput } from './schedule'

const INTERVAL_MS = 5 * 60_000 // 5 minutes, this feature's default
const NOW = 1_700_000_000_000 // arbitrary fixed epoch ms

function input(overrides: Partial<ScheduleInput>): ScheduleInput {
  return {
    now: NOW,
    lastSyncAt: null,
    intervalMs: INTERVAL_MS,
    hasDirty: true,
    pendingTimerAt: null,
    ...overrides,
  }
}

describe('decideSyncSchedule', () => {
  it('syncs promptly on the first-ever sync (no prior sync this session)', () => {
    const result = decideSyncSchedule(input({ lastSyncAt: null, hasDirty: true }))
    expect(result).toEqual({ kind: 'sync-now' })
  })

  it('syncs promptly when dirty documents exist at startup', () => {
    // Same shape as "first-ever sync" — `lastSyncAt` is session-local and
    // always starts `null` on a fresh load — but kept as its own case since
    // it exercises a distinct real scenario (edits made in a previous
    // session that never reached GitHub, not edits made just now).
    const result = decideSyncSchedule(
      input({ lastSyncAt: null, hasDirty: true, pendingTimerAt: null }),
    )
    expect(result).toEqual({ kind: 'sync-now' })
  })

  it('syncs promptly when a change arrives after the interval has already elapsed', () => {
    const result = decideSyncSchedule(input({ lastSyncAt: NOW - INTERVAL_MS - 1, hasDirty: true }))
    expect(result).toEqual({ kind: 'sync-now' })
  })

  it('syncs promptly exactly at the interval boundary', () => {
    const result = decideSyncSchedule(input({ lastSyncAt: NOW - INTERVAL_MS, hasDirty: true }))
    expect(result).toEqual({ kind: 'sync-now' })
  })

  it('schedules (does not sync) when a change arrives mid-interval', () => {
    const lastSyncAt = NOW - 1_000 // synced 1s ago, well inside the interval
    const result = decideSyncSchedule(input({ lastSyncAt, hasDirty: true, pendingTimerAt: null }))
    expect(result).toEqual({ kind: 'schedule-at', at: lastSyncAt + INTERVAL_MS })
  })

  it('does not stack a second timer when a change arrives while one is already scheduled', () => {
    const lastSyncAt = NOW - 1_000
    const dueAt = lastSyncAt + INTERVAL_MS
    const result = decideSyncSchedule(input({ lastSyncAt, hasDirty: true, pendingTimerAt: dueAt }))
    expect(result).toEqual({ kind: 'nothing' })
  })

  it('reschedules to an earlier time when the armed timer is later than newly due', () => {
    // e.g. the user just shortened the interval setting — the timer armed
    // under the old, longer interval fires too late for the new one.
    const lastSyncAt = NOW - 1_000
    const dueAt = lastSyncAt + INTERVAL_MS
    const staleLaterTimer = dueAt + 60_000
    const result = decideSyncSchedule(
      input({ lastSyncAt, hasDirty: true, pendingTimerAt: staleLaterTimer }),
    )
    expect(result).toEqual({ kind: 'schedule-at', at: dueAt })
  })

  it('leaves an already-armed earlier timer alone rather than stacking one on top', () => {
    const lastSyncAt = NOW - 1_000
    const dueAt = lastSyncAt + INTERVAL_MS
    const earlierTimer = dueAt - 60_000
    const result = decideSyncSchedule(
      input({ lastSyncAt, hasDirty: true, pendingTimerAt: earlierTimer }),
    )
    expect(result).toEqual({ kind: 'nothing' })
  })

  it('does nothing when nothing is dirty, regardless of timing', () => {
    expect(decideSyncSchedule(input({ hasDirty: false, lastSyncAt: null }))).toEqual({
      kind: 'nothing',
    })
    expect(
      decideSyncSchedule(input({ hasDirty: false, lastSyncAt: NOW - INTERVAL_MS - 1 })),
    ).toEqual({ kind: 'nothing' })
    expect(
      decideSyncSchedule(
        input({ hasDirty: false, lastSyncAt: NOW - 1_000, pendingTimerAt: NOW + 1_000 }),
      ),
    ).toEqual({ kind: 'nothing' })
  })
})

import { describe, expect, it } from 'vitest'

import { describeSyncStatus } from './syncStatusText'

const NOW = 1_700_000_000_000

describe('describeSyncStatus', () => {
  it('shows nothing sync-related when there is no connection', () => {
    expect(
      describeSyncStatus({ status: 'idle', lastSyncAt: null, errorMessage: null, nowMs: NOW }),
    ).toBeNull()
  })

  it('is a distinct state for "connected, never synced yet"', () => {
    expect(
      describeSyncStatus({ status: 'synced', lastSyncAt: null, errorMessage: null, nowMs: NOW }),
    ).toEqual({ kind: 'never-synced' })
  })

  it('is a distinct state while a sync is in flight', () => {
    expect(
      describeSyncStatus({
        status: 'syncing',
        lastSyncAt: NOW - 60_000,
        errorMessage: null,
        nowMs: NOW,
      }),
    ).toEqual({ kind: 'syncing' })
  })

  it('formats the relative time once synced', () => {
    expect(
      describeSyncStatus({
        status: 'synced',
        lastSyncAt: NOW - 3 * 60_000,
        errorMessage: null,
        nowMs: NOW,
      }),
    ).toEqual({ kind: 'synced', relative: '3 minutes ago' })
  })

  it('carries the error message through on failure', () => {
    expect(
      describeSyncStatus({
        status: 'error',
        lastSyncAt: NOW - 60_000,
        errorMessage: 'Could not reach GitHub. Check your connection and try again.',
        nowMs: NOW,
      }),
    ).toEqual({
      kind: 'error',
      message: 'Could not reach GitHub. Check your connection and try again.',
    })
  })

  it('falls back to a generic message if an error state somehow carries no message', () => {
    expect(
      describeSyncStatus({ status: 'error', lastSyncAt: null, errorMessage: null, nowMs: NOW }),
    ).toEqual({ kind: 'error', message: 'Could not sync to GitHub.' })
  })
})

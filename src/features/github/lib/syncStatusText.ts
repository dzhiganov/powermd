import { formatRelativeTime } from '@/shared/lib/relativeTime'

import type { SyncStatus } from '../model/sync'

/**
 * Every distinct state the status bar's sync readout can be in — a
 * discriminated union rather than a single formatted string, so the UI
 * layer decides icon/colour/error-emphasis per `kind` instead of parsing a
 * string back apart. `null` is its own fifth state: "not connected", which
 * the UI renders as nothing at all (see `SyncStatusIndicator.vue`'s
 * `visible` guard) — kept out of the union itself since there is no display
 * to describe for it.
 */
export type SyncStatusDisplay =
  | { kind: 'never-synced' }
  | { kind: 'syncing' }
  | { kind: 'synced'; relative: string }
  | { kind: 'error'; message: string }

export interface DescribeSyncStatusParams {
  status: SyncStatus
  lastSyncAt: number | null
  errorMessage: string | null
  nowMs: number
}

/**
 * Pure projection from the raw sync stores (`$syncStatus`/`$lastSyncAt`/
 * `$syncError`+`$importError`) to exactly one of the states a reader needs
 * to distinguish: connected-but-never-synced is its own case, separate from
 * "connected, currently syncing" and "connected, synced N ago" — collapsing
 * any of these into one generic "connected" state would be the thing this
 * function exists to prevent. `'idle'` (no sync connection at all) maps to
 * `null`: there is nothing sync-related to show before a connection exists.
 */
export function describeSyncStatus(params: DescribeSyncStatusParams): SyncStatusDisplay | null {
  const { status, lastSyncAt, errorMessage, nowMs } = params

  switch (status) {
    case 'idle':
      return null
    case 'syncing':
      return { kind: 'syncing' }
    case 'error':
      return { kind: 'error', message: errorMessage ?? 'Could not sync to GitHub.' }
    case 'synced':
      return lastSyncAt === null
        ? { kind: 'never-synced' }
        : { kind: 'synced', relative: formatRelativeTime(lastSyncAt, nowMs) }
  }
}

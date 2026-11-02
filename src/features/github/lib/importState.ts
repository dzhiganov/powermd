/**
 * Whether the first-connect import has finished for a connection — persisted,
 * so that an import cut short (it failed, or the tab was closed or reloaded
 * while it ran) is resumed on the next start instead of being forgotten.
 * Until it is set, `model/sync.ts` pushes no document that has never been
 * pushed: one could overwrite a file on GitHub the import has not read yet.
 *
 * Stores the connection it belongs to and is only ever honoured for that
 * exact owner/repo/branch/subfolder — same scoping as `lastPushedCommit.ts`.
 */
import { readStorage, writeStorage } from '@/shared/lib/storage'

import type { SyncConfig } from './config'

const KEY = 'markdown-editor:github-import-done'

function sameConnection(a: SyncConfig, b: Record<string, unknown>): boolean {
  return (
    a.owner === b.owner && a.repo === b.repo && a.branch === b.branch && a.subfolder === b.subfolder
  )
}

export function isImportDone(config: SyncConfig | null): boolean {
  if (config === null) return false
  const raw = readStorage(KEY)
  if (raw === null) return false
  try {
    const parsed: unknown = JSON.parse(raw)
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      sameConnection(config, parsed as Record<string, unknown>)
    )
  } catch {
    return false
  }
}

export function storeImportDone(config: SyncConfig): void {
  writeStorage(KEY, JSON.stringify(config))
}

export function clearImportDone(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore — same best-effort contract as `lib/token.ts`'s `clearStoredToken`
  }
}

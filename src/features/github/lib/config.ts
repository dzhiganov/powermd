/**
 * The one and only place the active sync connection (repo/branch/subfolder —
 * everything about "where documents sync to" except the token itself, which
 * `lib/token.ts` owns separately) is read from or written to persistent
 * storage. Same "single audit point" shape as `lib/token.ts`.
 *
 * Nothing here is sensitive — a repo full name, a branch name, a subfolder
 * path — so, unlike the token, this is fine to read back and display as-is.
 */
import { readStorage, writeStorage } from '@/shared/lib/storage'

export interface SyncConfig {
  owner: string
  repo: string
  branch: string
  /** Repo-root-relative, already `normalizeSubfolder`-ed (no leading/
   * trailing slash), or `''` for the repo root. */
  subfolder: string
}

const CONFIG_KEY = 'markdown-editor:github-sync-config'

function isSyncConfig(value: unknown): value is SyncConfig {
  if (typeof value !== 'object' || value === null) return false
  const raw = value as Record<string, unknown>
  return (
    typeof raw.owner === 'string' &&
    raw.owner !== '' &&
    typeof raw.repo === 'string' &&
    raw.repo !== '' &&
    typeof raw.branch === 'string' &&
    raw.branch !== '' &&
    typeof raw.subfolder === 'string'
  )
}

/** Reads the stored sync connection, or `null` if none is stored, storage is
 * unavailable, or the stored value is malformed/future-shaped — same
 * defensive "never throw" contract as `lib/token.ts`. */
export function getStoredConfig(): SyncConfig | null {
  const raw = readStorage(CONFIG_KEY)
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return isSyncConfig(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function storeConfig(config: SyncConfig): void {
  writeStorage(CONFIG_KEY, JSON.stringify(config))
}

export function clearStoredConfig(): void {
  try {
    localStorage.removeItem(CONFIG_KEY)
  } catch {
    // ignore — same best-effort contract as `lib/token.ts`'s `clearStoredToken`
  }
}

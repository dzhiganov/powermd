/**
 * Persists `model/sync.ts`'s `lastPushedCommitSha` — the commit this client
 * last successfully moved the branch ref to — across reloads and PWA
 * restarts. See that module's own doc comment on `lastPushedCommitSha` for
 * why remembering it matters at all (it lets a push build on the commit this
 * client just made instead of a `getBranchRef` read that may not have caught
 * up with it yet, which is exactly the propagation-lag race this feature was
 * seeing "Update is not a fast forward" from). A page reload used to forget
 * it every time — `null` again right when it was most needed, e.g. right
 * after an `updateRef` that landed on GitHub but whose response never made
 * it back (a reload mid-request, or an error thrown after the write actually
 * succeeded).
 *
 * Single-slot storage, scoped to one repo+branch by construction: the stored
 * value carries its own `owner`/`repo`/`branch` alongside the sha, and
 * `getStoredLastPushedCommit` only ever returns the sha when the caller's
 * `owner`/`repo`/`branch` match what's stored — a sha remembered for one
 * repository or branch is never handed back for another, even if this key
 * was never explicitly cleared for some reason (see `sync.ts`'s
 * `forgetLastPushedCommit`, called on `disconnectRequested` and
 * `syncConnected`, i.e. every disconnect and every repo/branch change, which
 * clears storage outright — this scoping check is the second, independent
 * layer of protection against the same mistake, not the only one). Trusting
 * a sha from the wrong repository would build a commit on a parent that
 * doesn't exist in that repo's history — a correctness bug strictly worse
 * than the "Update is not a fast forward" this feature exists to fix.
 *
 * Only a commit sha (a git object identifier, already public the moment it's
 * pushed) plus the plain-text owner/repo/branch identifying where it lives —
 * never a token or anything else sensitive — is ever written here. Same
 * best-effort, never-throws storage contract as `lib/token.ts`/
 * `lib/config.ts`: reads return `null` and writes silently no-op if storage
 * is unavailable (private mode, SSR, quota) or the stored value doesn't
 * parse as expected.
 */
import { readStorage, writeStorage } from '@/shared/lib/storage'

const KEY = 'markdown-editor:github-last-pushed-commit'

interface StoredLastPushedCommit {
  owner: string
  repo: string
  branch: string
  sha: string
}

function isStoredLastPushedCommit(value: unknown): value is StoredLastPushedCommit {
  if (typeof value !== 'object' || value === null) return false
  const raw = value as Record<string, unknown>
  return (
    typeof raw.owner === 'string' &&
    raw.owner !== '' &&
    typeof raw.repo === 'string' &&
    raw.repo !== '' &&
    typeof raw.branch === 'string' &&
    raw.branch !== '' &&
    typeof raw.sha === 'string' &&
    raw.sha !== ''
  )
}

/** The remembered commit sha for exactly this `owner`/`repo`/`branch`, or
 * `null` when nothing is stored, storage is unavailable, the stored value is
 * malformed/future-shaped, OR the stored value belongs to a different
 * repository or branch — that last case is the scoping guarantee described
 * above, checked on every read rather than trusted from the key alone. */
export function getStoredLastPushedCommit(
  owner: string,
  repo: string,
  branch: string,
): string | null {
  const raw = readStorage(KEY)
  if (raw === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isStoredLastPushedCommit(parsed)) return null
  if (parsed.owner !== owner || parsed.repo !== repo || parsed.branch !== branch) return null
  return parsed.sha
}

export function storeLastPushedCommit(
  owner: string,
  repo: string,
  branch: string,
  sha: string,
): void {
  writeStorage(KEY, JSON.stringify({ owner, repo, branch, sha }))
}

/** Clears the remembered commit unconditionally — called on disconnect and
 * on every repo/branch change (`sync.ts`'s `forgetLastPushedCommit`), so a
 * stale entry never lingers in storage even though `getStoredLastPushedCommit`
 * would already refuse to hand it back to a mismatched connection. */
export function clearStoredLastPushedCommit(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore — same best-effort contract as `lib/token.ts`'s `clearStoredToken`
  }
}

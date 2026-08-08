/**
 * The one and only place the sync connection's credential *kind* — a
 * personal access token, or a GitHub App user-to-server token — is read
 * from or written to persistent storage. Same "single audit point" shape as
 * `lib/token.ts`/`lib/appAuth.ts`.
 *
 * This exists because `lib/appAuth.ts`'s refresh-token metadata is NOT a
 * reliable way to tell the two apart: a GitHub App whose "expire user
 * authorization tokens" setting is turned OFF issues an access token with
 * no refresh token at all — the exact same shape `getStoredAppAuthMeta()`
 * returns for a PAT connection (which never has refresh metadata either).
 * `model/repos.ts` needs to know which kind is active before it decides
 * whether repositories are listed via `/user/repos` (a PAT can see
 * everything it's affiliated with) or via the installations endpoints (a
 * GitHub App token can only see repositories the App was actually
 * installed on) — see `lib/api.ts`'s `listAllRepos`/`listAllAppRepos`. So
 * the kind is declared explicitly by whichever flow obtains the
 * credential, never inferred from what that credential happens to carry.
 *
 * Declared via `model/connection.ts`'s `credentialKindDeclared` event —
 * `ui/GitHubSyncPanel.vue`'s PAT form declares `'pat'` on every submit
 * (even when replacing a stale `'app'` connection after a reauth), and
 * `model/oauth.ts` declares `'app'` when its code exchange succeeds.
 * `model/connection.ts`'s `initGithub()` re-validating a stored token on
 * startup deliberately does NOT redeclare it, so a reload preserves
 * whichever kind was last declared instead of resetting it.
 */

export type CredentialKind = 'pat' | 'app'

const KIND_KEY = 'markdown-editor:github-credential-kind'

function isCredentialKind(value: unknown): value is CredentialKind {
  return value === 'pat' || value === 'app'
}

/** Reads the stored kind, or `null` if none is stored, storage is
 * unavailable, or the stored value is malformed — same defensive "never
 * throw" contract as `lib/token.ts`. Every caller treats `null` as `'pat'`:
 * the only kind that existed before this file did, so a connection made
 * before this distinction was introduced keeps behaving exactly as it
 * always has. */
export function getStoredCredentialKind(): CredentialKind | null {
  try {
    const value = localStorage.getItem(KIND_KEY)
    return isCredentialKind(value) ? value : null
  } catch {
    return null
  }
}

/** Persists the kind. Silently no-ops if storage is unavailable — same
 * best-effort contract as `lib/token.ts`'s `storeToken`. */
export function storeCredentialKind(kind: CredentialKind): void {
  try {
    localStorage.setItem(KIND_KEY, kind)
  } catch {
    // ignore write failures (quota, privacy mode, etc.)
  }
}

/** Removes the stored kind. */
export function clearCredentialKind(): void {
  try {
    localStorage.removeItem(KIND_KEY)
  } catch {
    // ignore
  }
}

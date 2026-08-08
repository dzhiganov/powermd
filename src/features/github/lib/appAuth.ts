/**
 * The one and only place GitHub App refresh-token metadata (refresh token,
 * access-token expiry, refresh-token expiry) is read from or written to
 * persistent storage — same "single audit point" shape as `lib/token.ts`,
 * which continues to own the access token itself and is untouched by this
 * file.
 *
 * Split out from `lib/token.ts` rather than folded into it because a
 * personal access token has none of this: a PAT connection simply never
 * writes here, and `model/connection.ts`'s `getActiveToken` — and
 * everything built on it (`lib/api.ts`, the push engine, repo/branch
 * listing) — stays completely unaware this file exists. Only
 * `callWithToken`'s refresh-on-401 path (`model/connection.ts`) and the
 * OAuth callback that first populates it (`model/oauth.ts`) ever read or
 * write here.
 */

export interface AppAuthMeta {
  refreshToken: string
  /** Epoch ms the access token expires at, or `null` if this GitHub App has
   * token expiration turned off. */
  expiresAt: number | null
  /** Epoch ms the refresh token itself expires at, or `null` alongside a
   * `null` `expiresAt` — no expiration means no refresh token either. */
  refreshTokenExpiresAt: number | null
}

const META_KEY = 'markdown-editor:github-app-auth'

function isAppAuthMeta(value: unknown): value is AppAuthMeta {
  if (typeof value !== 'object' || value === null) return false
  const raw = value as Record<string, unknown>
  return (
    typeof raw.refreshToken === 'string' &&
    raw.refreshToken !== '' &&
    (raw.expiresAt === null || typeof raw.expiresAt === 'number') &&
    (raw.refreshTokenExpiresAt === null || typeof raw.refreshTokenExpiresAt === 'number')
  )
}

/** Reads the stored metadata, or `null` if none is stored, storage is
 * unavailable, or the stored value is malformed — same defensive
 * "never throw" contract as `lib/token.ts`/`lib/config.ts`. `null` here is
 * exactly what tells `callWithToken` a connection has nothing to refresh
 * (a PAT, or a GitHub App with expiration disabled). */
export function getStoredAppAuthMeta(): AppAuthMeta | null {
  try {
    const raw = localStorage.getItem(META_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    return isAppAuthMeta(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function storeAppAuthMeta(meta: AppAuthMeta): void {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta))
  } catch {
    // ignore write failures (quota, privacy mode, etc.) — same best-effort
    // contract as `lib/token.ts`'s `storeToken`.
  }
}

export function clearAppAuthMeta(): void {
  try {
    localStorage.removeItem(META_KEY)
  } catch {
    // ignore
  }
}

/**
 * Thin client for this app's own `/api/github/*` serverless functions — the
 * token exchange, refresh, and revoke calls GitHub's endpoints themselves
 * refuse to serve to a browser directly (no CORS headers on
 * `github.com/login/oauth/*` or `api.github.com/applications/*`). Mirrors
 * `lib/api.ts`'s "typed error, never log a secret" shape, though there's no
 * secret on this side of the exchange to begin with — the response is an
 * access token, the same sensitivity as a pasted PAT, and is handled the
 * same way from here on (`model/oauth.ts` hands it straight to
 * `model/connection.ts`'s `tokenSubmitted`, same as the PAT form does).
 */

/** This app's normalized token-result contract — matches
 * `api/_lib/githubToken.ts`'s `NormalizedTokenResult` on the server. Kept as
 * a separate, independently-declared type rather than imported across the
 * `src//api` boundary (there's no shared module reachable from both without
 * breaking `eslint-plugin-boundaries`' feature-isolation rule, which only
 * governs `src/**` but there's no reason to special-case around it for one
 * small interface). */
export interface AppTokenResult {
  accessToken: string
  tokenType: string
  expiresAt: string | null
  refreshToken: string | null
  refreshTokenExpiresAt: string | null
}

/** Matches `api/_lib/githubRevoke.ts`'s `RevokeResult` on the server. */
export interface AppRevokeResult {
  revoked: boolean
}

export class GitHubAppAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitHubAppAuthError'
  }
}

interface RawErrorBody {
  message?: string
}

function errorMessageFrom(body: unknown): string {
  if (typeof body === 'object' && body !== null) {
    const message = (body as RawErrorBody).message
    if (typeof message === 'string' && message !== '') return message
  }
  return 'GitHub sign-in failed.'
}

async function postJson<T>(path: string, body: Record<string, string>): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
  } catch {
    throw new GitHubAppAuthError(
      'Could not reach the sign-in server. Check your connection and try again.',
    )
  }

  let parsed: unknown
  try {
    parsed = await response.json()
  } catch {
    throw new GitHubAppAuthError('The sign-in server returned an unreadable response.')
  }

  if (!response.ok) {
    throw new GitHubAppAuthError(errorMessageFrom(parsed))
  }
  return parsed as T
}

/** `POST /api/github/token` — exchanges the authorization `code` from the
 * OAuth redirect for an access token. */
export function exchangeCodeForToken(code: string): Promise<AppTokenResult> {
  return postJson<AppTokenResult>('/api/github/token', { code })
}

/** `POST /api/github/refresh` — exchanges a stored refresh token for a new
 * access token. Called only from `model/connection.ts`'s `callWithToken` on
 * a 401. */
export function refreshAppToken(refreshToken: string): Promise<AppTokenResult> {
  return postJson<AppTokenResult>('/api/github/refresh', { refreshToken })
}

/** `POST /api/github/revoke` — revokes a GitHub-App-issued access token on
 * GitHub's side. Called only from `model/connection.ts`'s
 * `disconnectRequested` handling, and only for an `'app'`-kind credential
 * (see `lib/credentialKind.ts`) — a personal access token is never sent
 * here, since GitHub's revoke endpoint only works for tokens this app's own
 * GitHub App issued. */
export function revokeAppToken(token: string): Promise<AppRevokeResult> {
  return postJson<AppRevokeResult>('/api/github/revoke', { token })
}

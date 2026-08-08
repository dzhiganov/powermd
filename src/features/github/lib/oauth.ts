/**
 * Pure helpers for the "Sign in with GitHub" (GitHub App user-to-server)
 * flow: building the authorize redirect URL, and CSRF `state`
 * generation/verification/parsing. No storage, no `window`/`fetch` here —
 * see `model/oauth.ts` for where these are wired to the actual redirect and
 * the callback handling. Kept separate specifically so the CSRF-critical
 * logic is trivially unit-testable (`oauth.test.ts`) with no DOM mocking.
 */

/** The one path this app treats as "GitHub just redirected back here" —
 * see `model/oauth.ts`'s `initGithubOAuth`. Configured as this App's
 * callback URL on github.com (see the README for the exact GitHub App
 * settings), suffixed onto `window.location.origin` at redirect time. */
export const GITHUB_OAUTH_CALLBACK_PATH = '/auth/github/callback'

const AUTHORIZE_ENDPOINT = 'https://github.com/login/oauth/authorize'

/** A fresh, unguessable CSRF token for one sign-in attempt — `crypto.
 * randomUUID` needs a secure context, which this app already requires
 * (see `lib/hash.ts`'s identical assumption for `crypto.subtle`). */
export function generateOAuthState(): string {
  return crypto.randomUUID()
}

export interface AuthorizeUrlParams {
  clientId: string
  state: string
  redirectUri: string
}

/** The URL to send the user to start the flow. GitHub redirects back to
 * `redirectUri` with `?code=...&state=...` (or `?error=...` if the user
 * declines) once they approve. */
export function buildAuthorizeUrl({ clientId, state, redirectUri }: AuthorizeUrlParams): string {
  const url = new URL(AUTHORIZE_ENDPOINT)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('state', state)
  url.searchParams.set('redirect_uri', redirectUri)
  return url.toString()
}

/**
 * True only when both are non-empty and identical. Used by
 * `model/oauth.ts` to decide whether a callback's `state` matches the one
 * this tab generated and stored before redirecting away — a mismatch (or
 * either side missing, e.g. the expected value was never stored, or was
 * already consumed by an earlier callback) means the request did not
 * originate from this app's own sign-in attempt and must be rejected,
 * loudly, rather than silently treated as one.
 */
export function verifyOAuthState(expected: string | null, received: string | null): boolean {
  return expected !== null && expected !== '' && received !== null && expected === received
}

export interface ParsedCallbackSuccess {
  code: string
  state: string
}

export interface ParsedCallbackError {
  error: string
}

/**
 * Parses `?code=...&state=...` (success) or `?error=...` (the user declined
 * the authorization, or GitHub itself rejected the request) off a
 * callback URL's search string. Returns `null` when neither shape is
 * present — this wasn't actually a GitHub callback — which
 * `model/oauth.ts` treats as a silent no-op, distinct from an `error` result
 * (surfaced to the user) or a CSRF mismatch (checked by the caller against
 * `verifyOAuthState` once a success shape comes back from here).
 */
export function parseCallbackParams(
  search: string,
): ParsedCallbackSuccess | ParsedCallbackError | null {
  const params = new URLSearchParams(search)

  const error = params.get('error')
  if (error !== null && error !== '') {
    const description = params.get('error_description')
    return { error: description !== null && description !== '' ? description : error }
  }

  const code = params.get('code')
  const state = params.get('state')
  if (code === null || code === '' || state === null || state === '') return null

  return { code, state }
}

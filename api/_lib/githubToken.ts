/**
 * Server-side GitHub App user-token exchange. Both `api/github/token.ts`
 * (authorization `code` -> access token) and `api/github/refresh.ts`
 * (refresh token -> new access token) call GitHub's own OAuth token
 * endpoint with different grant parameters — this module is the ONE place
 * that talks to it, and the ONE place `client_secret` is used, read fresh
 * from the environment on every call via `requireEnv` (`./env.ts`), never a
 * literal, never cached, never logged, never put in a thrown message.
 *
 * `normalizeTokenResponse` is kept pure (parsed body + a `now` timestamp in,
 * a typed result out, no I/O) specifically so it's unit-testable without a
 * network call — see `githubToken.test.ts`. `exchangeWithGitHub` is the only
 * function here that actually calls `fetch`, and it always calls the same
 * hardcoded `TOKEN_ENDPOINT` — nothing in this module ever fetches a
 * caller-supplied URL, so there's no way to turn either handler into an open
 * proxy.
 */
import { requireEnv } from './env'

const TOKEN_ENDPOINT = 'https://github.com/login/oauth/access_token'

/** This app's own normalized shape for a token result — what both
 * `api/github/token.ts` and `api/github/refresh.ts` return, and what
 * `src/features/github/lib/appApi.ts` (the client) parses. Absolute
 * timestamps (ISO 8601), not GitHub's relative `expires_in` seconds, so the
 * client never has to know when the request was made to do that math
 * itself. */
export interface NormalizedTokenResult {
  accessToken: string
  tokenType: string
  /** `null` when this GitHub App has "expire user authorization tokens"
   * turned off — GitHub's user tokens never expire in that configuration. */
  expiresAt: string | null
  /** `null` under the same condition as `expiresAt` — no expiry, no refresh
   * token either. */
  refreshToken: string | null
  refreshTokenExpiresAt: string | null
}

export class GitHubTokenExchangeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitHubTokenExchangeError'
  }
}

/** GitHub's raw token-endpoint response shape — only the fields this app
 * reads. `expires_in`/`refresh_token`/`refresh_token_expires_in` are present
 * only when the App has token expiration enabled; `error`/
 * `error_description` replace everything else when the exchange itself was
 * rejected (GitHub answers this endpoint with HTTP 200 even for a rejected
 * exchange, using the body to carry the failure — so this shape, not the
 * HTTP status, is what `normalizeTokenResponse` actually branches on). */
interface RawTokenResponse {
  access_token?: string
  token_type?: string
  expires_in?: number
  refresh_token?: string
  refresh_token_expires_in?: number
  error?: string
  error_description?: string
}

function isRawTokenResponse(value: unknown): value is RawTokenResponse {
  return typeof value === 'object' && value !== null
}

function absoluteIsoTime(nowMs: number, relativeSeconds: number): string {
  return new Date(nowMs + relativeSeconds * 1000).toISOString()
}

/**
 * Turns GitHub's raw token-endpoint body into this app's normalized
 * contract. Pure — no I/O, `nowMs` passed in rather than read via
 * `Date.now()` — so it's trivially unit-testable.
 */
export function normalizeTokenResponse(body: unknown, nowMs: number): NormalizedTokenResult {
  if (!isRawTokenResponse(body)) {
    throw new GitHubTokenExchangeError('GitHub returned an unrecognized response.')
  }
  if (body.error !== undefined) {
    const description = body.error_description
    throw new GitHubTokenExchangeError(
      description !== undefined && description !== ''
        ? description
        : `GitHub rejected the request: ${body.error}`,
    )
  }
  if (typeof body.access_token !== 'string' || body.access_token === '') {
    throw new GitHubTokenExchangeError('GitHub did not return an access token.')
  }

  const hasRefresh = typeof body.refresh_token === 'string' && body.refresh_token !== ''

  return {
    accessToken: body.access_token,
    tokenType:
      typeof body.token_type === 'string' && body.token_type !== '' ? body.token_type : 'bearer',
    expiresAt: typeof body.expires_in === 'number' ? absoluteIsoTime(nowMs, body.expires_in) : null,
    refreshToken: hasRefresh ? (body.refresh_token as string) : null,
    refreshTokenExpiresAt:
      hasRefresh && typeof body.refresh_token_expires_in === 'number'
        ? absoluteIsoTime(nowMs, body.refresh_token_expires_in)
        : null,
  }
}

interface ExchangeParams {
  grantType: 'authorization_code' | 'refresh_token'
  code?: string
  refreshToken?: string
}

/** Calls GitHub's token endpoint with the grant this call needs (an
 * authorization `code`, or a `refreshToken`) and normalizes the result.
 * `client_id`/`client_secret` are read fresh from the environment on every
 * call — see the module doc comment. */
export async function exchangeWithGitHub(params: ExchangeParams): Promise<NormalizedTokenResult> {
  const clientId = requireEnv('GITHUB_APP_CLIENT_ID')
  const clientSecret = requireEnv('GITHUB_APP_CLIENT_SECRET')

  const body: Record<string, string> = {
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: params.grantType,
  }
  if (params.code !== undefined) body.code = params.code
  if (params.refreshToken !== undefined) body.refresh_token = params.refreshToken

  let response: Response
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new GitHubTokenExchangeError('Could not reach GitHub.')
  }

  let parsed: unknown
  try {
    parsed = await response.json()
  } catch {
    throw new GitHubTokenExchangeError('GitHub returned an unreadable response.')
  }

  return normalizeTokenResponse(parsed, Date.now())
}

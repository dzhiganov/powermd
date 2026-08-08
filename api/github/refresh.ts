/**
 * `POST /api/github/refresh` — exchanges a GitHub App refresh token for a
 * new user access token. Only reachable, and only useful, for a connection
 * whose App has "expire user authorization tokens" turned on — see
 * `src/features/github/model/connection.ts`'s `callWithToken`, the only
 * caller, which reads a stored refresh token before ever POSTing here.
 *
 * Same contract as `./token.ts`: exactly one fixed upstream URL, no
 * caller-supplied URL ever reached, `client_secret` read fresh from
 * `requireEnv('GITHUB_APP_CLIENT_SECRET')` on every call and never echoed
 * anywhere.
 */
import { exchangeWithGitHub } from '../_lib/githubToken'
import {
  errorResponse,
  InvalidRequestError,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
} from '../_lib/http'

export const config = { runtime: 'edge' }

function readRefreshToken(body: unknown): string {
  if (typeof body !== 'object' || body === null) {
    throw new InvalidRequestError('Expected a JSON object body.')
  }
  const refreshToken = (body as Record<string, unknown>).refreshToken
  if (typeof refreshToken !== 'string' || refreshToken.trim() === '') {
    throw new InvalidRequestError('"refreshToken" is required and must be a non-empty string.')
  }
  return refreshToken
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()

  try {
    const refreshToken = readRefreshToken(await readJsonBody(request))
    const result = await exchangeWithGitHub({ grantType: 'refresh_token', refreshToken })
    return jsonResponse(200, result)
  } catch (error) {
    return errorResponse(error)
  }
}

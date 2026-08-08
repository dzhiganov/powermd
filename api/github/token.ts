/**
 * `POST /api/github/token` — exchanges a GitHub OAuth authorization `code`
 * (the user-to-server flow's callback param — see
 * `src/features/github/model/oauth.ts`) for a GitHub App user access token.
 *
 * GitHub's own token endpoint sends no CORS headers, so a browser can never
 * complete this exchange on its own — that's the entire reason this
 * function exists. It talks to exactly one fixed URL
 * (`https://github.com/login/oauth/access_token`, hardcoded in
 * `../_lib/githubToken.ts`) and never forwards a caller-supplied URL
 * anywhere, so it cannot be used as an open proxy. `client_secret` comes
 * only from `requireEnv('GITHUB_APP_CLIENT_SECRET')` (`../_lib/env.ts`) —
 * never a literal in this file, never in the response body, never in a
 * thrown message.
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

function readCode(body: unknown): string {
  if (typeof body !== 'object' || body === null) {
    throw new InvalidRequestError('Expected a JSON object body.')
  }
  const code = (body as Record<string, unknown>).code
  if (typeof code !== 'string' || code.trim() === '') {
    throw new InvalidRequestError('"code" is required and must be a non-empty string.')
  }
  return code
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()

  try {
    const code = readCode(await readJsonBody(request))
    const result = await exchangeWithGitHub({ grantType: 'authorization_code', code })
    return jsonResponse(200, result)
  } catch (error) {
    return errorResponse(error)
  }
}

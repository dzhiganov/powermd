/**
 * `POST /api/github/revoke` — revokes the GitHub App's authorization grant
 * for the caller's user access token via GitHub's own grant-revocation
 * endpoint (`../_lib/githubRevoke.ts`), so that "Disconnect"
 * (`src/features/github/model/connection.ts`'s `disconnectRequested`)
 * actually ends the authorization on GitHub's side — not just the one
 * token — so the next "Sign in with GitHub" shows the consent screen again
 * instead of silently reconnecting.
 *
 * Same contract as `./token.ts`/`./refresh.ts`: this function talks to
 * exactly one fixed upstream URL (built in `../_lib/githubRevoke.ts` from a
 * `client_id` read via `requireEnv`, never from anything in this request),
 * so it can never be used as an open proxy. `client_secret` comes only from
 * `requireEnv('GITHUB_APP_CLIENT_SECRET')` — never a literal in this file,
 * never in the response body, never in a thrown message.
 *
 * Only ever called for a GitHub-App-issued token
 * (`credentialKindDeclared('app')` in `model/connection.ts`) — a pasted
 * personal access token cannot be revoked this way and the client never
 * calls this endpoint for one.
 */
import { revokeWithGitHub } from '../_lib/githubRevoke'
import {
  errorResponse,
  InvalidRequestError,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
} from '../_lib/http'

export const config = { runtime: 'edge' }

function readToken(body: unknown): string {
  if (typeof body !== 'object' || body === null) {
    throw new InvalidRequestError('Expected a JSON object body.')
  }
  const token = (body as Record<string, unknown>).token
  if (typeof token !== 'string' || token.trim() === '') {
    throw new InvalidRequestError('"token" is required and must be a non-empty string.')
  }
  return token
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()

  try {
    const token = readToken(await readJsonBody(request))
    const result = await revokeWithGitHub(token)
    return jsonResponse(200, result)
  } catch (error) {
    return errorResponse(error)
  }
}

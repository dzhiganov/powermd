/**
 * Server-side GitHub token revocation — `DELETE
 * https://api.github.com/applications/{client_id}/token`, authenticated
 * with HTTP Basic (`client_id`:`client_secret`), the access token to revoke
 * carried in the JSON body. This is GitHub's own revoke endpoint for both
 * OAuth Apps and GitHub Apps (the "OAuth application owners can revoke a
 * single token" API) — the counterpart to `githubToken.ts`'s exchange, and
 * the ONLY place this app calls it.
 *
 * Same safety contract as `githubToken.ts`: the URL is built ONLY from a
 * `client_id` read fresh from `requireEnv('GITHUB_APP_CLIENT_ID')` — never
 * from anything the caller sends — so this can never be turned into an open
 * proxy. `client_secret` is likewise read fresh via `requireEnv` on every
 * call, never a literal, never cached, never logged, never put in a thrown
 * message. The access token being revoked is the caller's OWN token
 * (`api/github/revoke.ts` reads it from the request body only to forward it
 * to GitHub — it never appears in this module's logs or errors either).
 */
import { requireEnv } from './env'

function revokeEndpoint(clientId: string): string {
  return `https://api.github.com/applications/${encodeURIComponent(clientId)}/token`
}

export class GitHubRevokeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitHubRevokeError'
  }
}

export interface RevokeResult {
  revoked: boolean
}

interface RawErrorBody {
  message?: string
}

function errorMessageFrom(body: unknown, status: number): string {
  if (typeof body === 'object' && body !== null) {
    const message = (body as RawErrorBody).message
    if (typeof message === 'string' && message !== '') return message
  }
  return `GitHub rejected the revoke request (status ${status}).`
}

/**
 * Revokes `accessToken` via GitHub's application-token endpoint.
 *
 * GitHub answers a successful revoke with `204 No Content` — no body to
 * parse. A `404` means GitHub has no record of that token to revoke (it was
 * already revoked, already expired, or never valid to begin with) — the
 * same end state this call is trying to reach, so it's treated as a success
 * too rather than surfaced as a failure the caller would have no useful way
 * to retry. Any other status is a genuine failure, mapped to
 * `GitHubRevokeError` with GitHub's own `message` when it sends one (never
 * anything server-secret — `client_secret` never reaches this branch, it's
 * only ever sent, never received back).
 *
 * NOTE: this success/404 mapping is a documented assumption based on
 * GitHub's published API reference, not verified against a live call — see
 * `githubRevoke.test.ts` and this feature's rollout notes for what is
 * mock-verified vs. unverifiable without a real GitHub App + credentials.
 */
export async function revokeWithGitHub(accessToken: string): Promise<RevokeResult> {
  const clientId = requireEnv('GITHUB_APP_CLIENT_ID')
  const clientSecret = requireEnv('GITHUB_APP_CLIENT_SECRET')

  let response: Response
  try {
    response = await fetch(revokeEndpoint(clientId), {
      method: 'DELETE',
      headers: {
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      },
      body: JSON.stringify({ access_token: accessToken }),
    })
  } catch {
    throw new GitHubRevokeError('Could not reach GitHub.')
  }

  if (response.status === 204 || response.status === 404) {
    return { revoked: true }
  }

  let parsed: unknown = null
  try {
    parsed = await response.json()
  } catch {
    // No JSON body (or unreadable) — fall back to the generic status-based
    // message built below.
  }
  throw new GitHubRevokeError(errorMessageFrom(parsed, response.status))
}

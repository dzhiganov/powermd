/**
 * Tiny, dependency-free HTTP helpers shared by every function under
 * `api/github/`. Every function here works against the standard Web
 * `Request`/`Response` (Vercel Edge Functions), not Node's `http` types —
 * see `tsconfig.api.json`.
 */
import { MissingEnvError } from './env'
import { GitHubTokenExchangeError } from './githubToken'
import { GitHubRevokeError } from './githubRevoke'

/** A request that fails validation before ever reaching GitHub — bad JSON,
 * a missing/malformed field. Always a 400, and the message is always safe
 * to return as-is: it describes what shape was expected, never anything the
 * caller sent back to them. */
export class InvalidRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidRequestError'
  }
}

// Generous enough for a JSON body carrying a code/refresh token (a few
// hundred bytes at most) with headroom to spare, tight enough that this
// can't be used to push an oversized body through the function.
const MAX_BODY_BYTES = 16 * 1024

/** Reads and JSON-parses the request body, rejecting anything oversized,
 * empty, or not valid JSON via `InvalidRequestError`. Reads the body itself
 * (`request.text()`) rather than trusting any platform-specific
 * pre-parsing, so this behaves identically regardless of runtime. */
export async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) {
    throw new InvalidRequestError('Request body is too large.')
  }
  if (text.trim() === '') {
    throw new InvalidRequestError('Request body must be JSON.')
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new InvalidRequestError('Request body must be valid JSON.')
  }
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // Belt-and-suspenders alongside `vercel.json`'s own `Cache-Control`
      // rule for `/api/(.*)` and the service worker's `NetworkOnly` rule
      // for the same path — a cached token-exchange response would be both
      // wrong and a security problem, so every layer says so independently.
      'Cache-Control': 'no-store',
    },
  })
}

export function methodNotAllowed(): Response {
  return jsonResponse(405, { error: 'method_not_allowed', message: 'Only POST is supported.' })
}

/**
 * Maps every error this feature's handlers can throw to a typed JSON error
 * body the client can act on — never GitHub's raw response, never an env
 * var's name or value, never a stack trace. Anything unrecognized collapses
 * to a flat, generic 500 rather than risking an accidental leak through a
 * library's own `Error#message`.
 */
export function errorResponse(error: unknown): Response {
  if (error instanceof InvalidRequestError) {
    return jsonResponse(400, { error: 'invalid_request', message: error.message })
  }
  if (error instanceof MissingEnvError) {
    return jsonResponse(500, {
      error: 'server_misconfigured',
      message: 'Server is misconfigured. Contact the app owner.',
    })
  }
  if (error instanceof GitHubTokenExchangeError) {
    return jsonResponse(502, { error: 'github_token_exchange_failed', message: error.message })
  }
  if (error instanceof GitHubRevokeError) {
    return jsonResponse(502, { error: 'github_revoke_failed', message: error.message })
  }
  return jsonResponse(500, { error: 'internal_error', message: 'Something went wrong.' })
}

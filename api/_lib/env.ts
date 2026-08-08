/**
 * Vercel Edge Functions expose `process.env` for reading Environment
 * Variables, same as the Node.js runtime does — but this project's Edge
 * tsconfig (`tsconfig.api.json`) deliberately does NOT include `@types/node`:
 * its ambient `fetch`/`Request`/`Response`/`Headers` declarations collide
 * with the DOM lib these functions actually run against, the exact class of
 * conflict `tsconfig.worker.json` documents for the WebWorker lib elsewhere
 * in this project. This is the minimal ambient declaration needed to type
 * the one Node-shaped global this code touches, without pulling in the rest
 * of `@types/node`.
 */
declare const process: { env: Record<string, string | undefined> }

/** Thrown by `requireEnv` when a required Environment Variable is absent.
 * The variable NAME is safe to carry (it identifies configuration, not a
 * secret value), but `errorResponse` in `http.ts` still never forwards even
 * that to the client — callers get a flat "server is misconfigured". */
export class MissingEnvError extends Error {
  constructor(name: string) {
    super(`Server is misconfigured: missing required environment variable ${name}.`)
    this.name = 'MissingEnvError'
  }
}

/** Reads a required Environment Variable, or throws `MissingEnvError`.
 * Never caches the value at module scope — read fresh on every call, so a
 * secret never outlives the single request it was needed for any longer
 * than the JS engine's own GC would anyway. */
export function requireEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new MissingEnvError(name)
  }
  return value
}

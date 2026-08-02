/**
 * The one and only place the GitHub personal access token is read from or
 * written to persistent storage. No other file in this feature (or anywhere
 * in the app) may touch this localStorage key directly — every read/write
 * goes through the accessors here, so there's exactly one audit point for
 * where the token lives.
 *
 * The token is never logged, never put into a thrown error's message, and
 * never surfaced anywhere except through `maskToken` below.
 */
const TOKEN_KEY = 'markdown-editor:github-token'

/** Reads the stored token, or `null` if none is stored (or storage is
 * unavailable — private mode, SSR, quota). Fails silently like
 * `shared/lib/storage.ts`, never throws. */
export function getStoredToken(): string | null {
  try {
    const value = localStorage.getItem(TOKEN_KEY)
    return value === null || value === '' ? null : value
  } catch {
    return null
  }
}

/** Persists the token. Silently no-ops if storage is unavailable — the
 * in-memory connection still works for the session, it just won't survive a
 * reload. */
export function storeToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // ignore write failures (quota, privacy mode, etc.)
  }
}

/** Removes the stored token. */
export function clearStoredToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // ignore
  }
}

/** Renders a token as a short masked hint — an ellipsis plus its last 4
 * characters, e.g. `…AbC1`. Never reveals more than the final 4 characters,
 * and returns just the ellipsis for a token too short to have 4. This is the
 * only representation of a token allowed to reach the UI. */
export function maskToken(token: string): string {
  if (token.length <= 4) return '…'
  return `…${token.slice(-4)}`
}

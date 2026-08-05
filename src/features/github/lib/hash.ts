/**
 * SHA-256 hex digest of a string's UTF-8 bytes, via `SubtleCrypto`. Used to
 * detect "changed since last sync" per document without re-uploading
 * unchanged content — see `model/sync.ts`'s dirty-document check, which
 * compares this against `GitHubOrigin.syncedHash`.
 *
 * `crypto.subtle` requires a secure context (HTTPS, or `localhost`), which
 * every environment this app ships to satisfies (the app itself needs a
 * secure context already, for `crypto.randomUUID` in `documents/lib/id.ts`).
 */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

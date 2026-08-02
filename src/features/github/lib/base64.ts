/**
 * UTF-8-safe base64, done in chunks.
 *
 * `btoa`/`atob` only speak Latin-1 (`btoa` throws on any code point above
 * 0xFF), so a markdown file with any non-ASCII character — an em dash, an
 * accented name, an emoji — can't be handed to `btoa` directly. Going
 * through `TextEncoder`/`TextDecoder` converts to and from real UTF-8 bytes;
 * the intermediate binary string is built in 0x8000-byte chunks so a large
 * file can't blow the argument limit of `String.fromCharCode(...spread)`.
 *
 * This is the single most correctness-critical part of the GitHub feature —
 * every file that round-trips through GitHub's contents API passes through
 * here in both directions.
 */
export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export function base64ToUtf8(base64: string): string {
  // GitHub returns content base64-encoded WITH embedded newlines — strip them.
  const clean = base64.replace(/\n/g, '')
  const binary = atob(clean)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

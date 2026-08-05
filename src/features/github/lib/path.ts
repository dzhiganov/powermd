/**
 * Validates a repo-root-relative path before it's ever sent to GitHub — used
 * by "Save to GitHub" (`model/save.ts`) so a malformed path never reaches
 * the network. Returns a short, user-facing message when the path is
 * rejected, or `null` when it's fine to submit.
 *
 * Rejects a leading slash (paths here are already repo-root-relative, same
 * as every path this feature already reads from `getTree`), a trailing
 * slash (no file name), any `.`/`..` segment (path traversal has no meaning
 * against a flat repo-root-relative contents path), an empty segment (a
 * literal `//`), and an absurdly long path or segment.
 */

const MAX_PATH_LENGTH = 1024
const MAX_SEGMENT_LENGTH = 255

export function validateGithubPath(path: string): string | null {
  if (path.trim() === '') return 'Enter a path.'
  if (path.startsWith('/')) return 'Path must not start with "/".'
  if (path.endsWith('/')) return 'Path must not end with "/" — include a file name.'
  if (path.length > MAX_PATH_LENGTH) {
    return `Path is too long (max ${MAX_PATH_LENGTH} characters).`
  }
  for (const segment of path.split('/')) {
    if (segment === '') return 'Path must not contain an empty segment ("//").'
    if (segment === '.' || segment === '..') {
      return 'Path must not contain "." or ".." segments.'
    }
    if (segment.length > MAX_SEGMENT_LENGTH) {
      return `Each path segment must be at most ${MAX_SEGMENT_LENGTH} characters.`
    }
  }
  return null
}

/**
 * Normalizes a user-entered "sync into this subfolder" value: trims
 * whitespace, strips leading/trailing slashes, and collapses to `''`
 * (meaning "repo root") for blank input. Used by `model/connection.ts` before
 * a subfolder is ever stored in a `SyncConfig` or prefixed onto a document
 * path, so every path built downstream can assume a subfolder is either `''`
 * or a clean, slash-free-at-the-edges value with no further cleanup needed.
 */
export function normalizeSubfolder(input: string): string {
  return input.trim().replace(/^\/+/, '').replace(/\/+$/, '')
}

/**
 * Validates an already-`normalizeSubfolder`-ed value. A blank subfolder
 * (repo root) is always valid — this only rejects a *non-blank* value that
 * would produce a broken path once documents are prefixed with it: a `.`/
 * `..` segment (traversal), an empty segment (a literal `//` typed in the
 * middle), or a segment/overall length past what `validateGithubPath` itself
 * would accept once this prefix is combined with a document's own path.
 */
export function validateSubfolder(subfolder: string): string | null {
  if (subfolder === '') return null
  if (subfolder.length > MAX_PATH_LENGTH) {
    return `Subfolder is too long (max ${MAX_PATH_LENGTH} characters).`
  }
  for (const segment of subfolder.split('/')) {
    if (segment === '') return 'Subfolder must not contain an empty segment ("//").'
    if (segment === '.' || segment === '..') {
      return 'Subfolder must not contain "." or ".." segments.'
    }
    if (segment.length > MAX_SEGMENT_LENGTH) {
      return `Each subfolder segment must be at most ${MAX_SEGMENT_LENGTH} characters.`
    }
  }
  return null
}

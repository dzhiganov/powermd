const ILLEGAL_CHARS = /[/\\:*?"<>|]/g
const MAX_FILENAME_LENGTH = 100

/**
 * Turns a document title into a filesystem-safe download filename (sans
 * extension): strips characters illegal on Windows/macOS/Linux, collapses
 * the whitespace runs left behind, falls back for an empty/whitespace-only
 * title, and caps the length so an extremely long title can't produce a
 * filename some filesystems would reject.
 */
export function sanitizeFilename(title: string): string {
  const stripped = title.replace(ILLEGAL_CHARS, ' ').replace(/\s+/g, ' ').trim()
  const base = stripped === '' ? 'untitled' : stripped
  const truncated = base.slice(0, MAX_FILENAME_LENGTH).trim()
  return truncated === '' ? 'untitled' : truncated
}

/** Strips a trailing `.ext` from a filename, for deriving an imported
 * document's title (`features/transfer`'s import path). A leading-dot
 * dotfile (`.md`) or a name with no extension at all is returned as-is —
 * `lastIndexOf('.') <= 0` covers both (no dot, or only a leading one). */
export function stripExtension(filename: string): string {
  const index = filename.lastIndexOf('.')
  return index <= 0 ? filename : filename.slice(0, index)
}

/**
 * Derives a human-readable title from a document's content — the first
 * non-empty line, with a leading markdown heading marker and the most common
 * inline markers stripped, capped to a sensible length. Returns `''` when
 * the content is empty/whitespace so callers can fall back to a default.
 * Used only to name the auto-seeded welcome document; user-created documents
 * are titled explicitly and renamed by hand.
 */
export function deriveTitle(content: string): string {
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (line === '') continue
    const withoutHeading = line.replace(/^#{1,6}\s+/, '')
    const text = withoutHeading.replace(/[*_`~>#[\]]/g, '').trim()
    return text.slice(0, 60)
  }
  return ''
}

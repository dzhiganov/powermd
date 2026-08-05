import type { MarkdownDocument } from '../model/types'

export type SearchMatchLocation = 'title' | 'content' | 'both'

export interface SearchResult {
  doc: MarkdownDocument
  /** The folder this document lives in, or `null` for a root-level
   * document — shown next to the result so a match away from the folder
   * the user is currently looking at still reads as "found, and here's
   * where". */
  folderName: string | null
  matchedIn: SearchMatchLocation
  /** A short excerpt of `doc.content` centred on the first match,
   * collapsed to one line. `null` when the match is title-only — nothing
   * useful to excerpt from content that didn't match. */
  snippet: string | null
}

const SNIPPET_RADIUS = 60

function buildSnippet(content: string, lowerContent: string, lowerQuery: string): string {
  const index = lowerContent.indexOf(lowerQuery)
  if (index === -1) return ''
  const start = Math.max(0, index - SNIPPET_RADIUS)
  const end = Math.min(content.length, index + lowerQuery.length + SNIPPET_RADIUS)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < content.length ? '…' : ''
  // Collapse newlines/runs of whitespace so a match spanning a line break
  // still reads as one continuous snippet, the way a search result
  // excerpt normally does.
  const collapsed = content.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${prefix}${collapsed}${suffix}`
}

/**
 * Filters `docs` by title and content, case-insensitively. Pure and
 * synchronous — no I/O, no DOM — so it can be called directly against
 * whatever `$documentList` already holds in memory (every document's full
 * `content` lives there already; see `model/documents.ts`) without a
 * second IndexedDB read. Callers own debouncing (see `model/search.ts`);
 * this function itself is the part whose cost was actually measured (see
 * that module's doc comment) — instrumenting it in isolation is what made
 * "does this need an inverted index" a measured decision rather than a
 * guess.
 */
export function searchDocuments(
  docs: readonly MarkdownDocument[],
  folderNames: ReadonlyMap<string, string>,
  query: string,
): SearchResult[] {
  const trimmed = query.trim()
  if (trimmed === '') return []
  const lowerQuery = trimmed.toLowerCase()

  const results: SearchResult[] = []
  for (const doc of docs) {
    const lowerTitle = doc.title.toLowerCase()
    const lowerContent = doc.content.toLowerCase()
    const inTitle = lowerTitle.includes(lowerQuery)
    const inContent = lowerContent.includes(lowerQuery)
    if (!inTitle && !inContent) continue

    results.push({
      doc,
      folderName: doc.folderId === null ? null : (folderNames.get(doc.folderId) ?? null),
      matchedIn: inTitle && inContent ? 'both' : inTitle ? 'title' : 'content',
      snippet: inContent ? buildSnippet(doc.content, lowerContent, lowerQuery) : null,
    })
  }
  return results
}

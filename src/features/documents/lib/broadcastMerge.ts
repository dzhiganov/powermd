import type { DocumentBroadcast } from './db'
import type { MarkdownDocument } from '../model/types'

/**
 * Applies another tab's document write or delete to this tab's list.
 *
 * A newer `updatedAt` always wins. An equal one wins only when the content is
 * the same too: that is a metadata-only write (a GitHub sync origin, a move
 * between folders), which deliberately leaves `updatedAt` alone. Ignoring
 * those left this tab with a stale GitHub `syncedHash`, so it pushed content
 * the other tab had already pushed. Equal `updatedAt` with different content
 * is two tabs editing in the same millisecond, and this tab's copy is kept.
 */
export function mergeDocumentBroadcast(
  docs: MarkdownDocument[],
  message: DocumentBroadcast,
): MarkdownDocument[] {
  if (message.type === 'delete') {
    return docs.filter((doc) => doc.id !== message.id)
  }
  const incoming = message.document
  const existing = docs.find((doc) => doc.id === incoming.id)
  if (existing === undefined) return [incoming, ...docs]
  if (incoming.updatedAt < existing.updatedAt) return docs
  if (incoming.updatedAt === existing.updatedAt && incoming.content !== existing.content) {
    return docs
  }
  return docs.map((doc) => (doc.id === incoming.id ? incoming : doc))
}

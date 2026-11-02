import { describe, expect, it } from 'vitest'

import { mergeDocumentBroadcast } from './broadcastMerge'
import type { MarkdownDocument } from '../model/types'

const ORIGIN = { owner: 'alice', repo: 'notes', branch: 'main', path: 'doc.md' }

function doc(overrides: Partial<MarkdownDocument> = {}): MarkdownDocument {
  return {
    id: 'doc-1',
    title: 'Doc',
    content: 'hello',
    createdAt: 1,
    updatedAt: 10,
    folderId: null,
    origin: { ...ORIGIN, syncedHash: null },
    ...overrides,
  }
}

describe('mergeDocumentBroadcast', () => {
  it('takes a metadata-only write from another tab (same updatedAt, same content)', () => {
    // The other tab pushed this document to GitHub and recorded the hash,
    // without touching `updatedAt`.
    const synced = doc({ origin: { ...ORIGIN, syncedHash: 'abc' } })
    const merged = mergeDocumentBroadcast([doc()], { type: 'put', document: synced })
    expect(merged[0].origin?.syncedHash).toBe('abc')
  })

  it('keeps this tab’s copy when the same updatedAt carries different content', () => {
    const mine = doc({ content: 'mine' })
    const merged = mergeDocumentBroadcast([mine], {
      type: 'put',
      document: doc({ content: 'theirs' }),
    })
    expect(merged[0]).toBe(mine)
  })

  it('ignores an older write and takes a newer one', () => {
    const mine = doc()
    expect(
      mergeDocumentBroadcast([mine], { type: 'put', document: doc({ updatedAt: 5 }) })[0],
    ).toBe(mine)
    expect(
      mergeDocumentBroadcast([mine], {
        type: 'put',
        document: doc({ updatedAt: 11, content: 'new' }),
      })[0].content,
    ).toBe('new')
  })

  it('adds an unknown document and removes a deleted one', () => {
    const other = doc({ id: 'doc-2' })
    expect(mergeDocumentBroadcast([doc()], { type: 'put', document: other })).toHaveLength(2)
    expect(mergeDocumentBroadcast([doc()], { type: 'delete', id: 'doc-1' })).toEqual([])
  })
})

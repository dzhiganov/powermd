import { describe, expect, it } from 'vitest'

import { isWordCompletionActive, type WordCompletionScopeInput } from './wordCompletionScope'

const BASE: WordCompletionScopeInput = {
  globalEnabled: true,
  excludedFolderIds: [],
  documentFolderId: null,
}

describe('isWordCompletionActive', () => {
  it('is inactive when the global toggle is off, even for a root document', () => {
    expect(isWordCompletionActive({ ...BASE, globalEnabled: false })).toBe(false)
  })

  it('is inactive when the global toggle is off, even for a non-excluded folder', () => {
    expect(
      isWordCompletionActive({
        ...BASE,
        globalEnabled: false,
        documentFolderId: 'folder-1',
        excludedFolderIds: ['folder-2'],
      }),
    ).toBe(false)
  })

  it('is active for a document at the root, regardless of the exclusion list', () => {
    expect(
      isWordCompletionActive({
        ...BASE,
        documentFolderId: null,
        excludedFolderIds: ['folder-1', 'folder-2'],
      }),
    ).toBe(true)
  })

  it('is inactive for a document inside an excluded folder', () => {
    expect(
      isWordCompletionActive({
        ...BASE,
        documentFolderId: 'folder-1',
        excludedFolderIds: ['folder-1'],
      }),
    ).toBe(false)
  })

  it('is active for a document inside a folder that is not excluded', () => {
    expect(
      isWordCompletionActive({
        ...BASE,
        documentFolderId: 'folder-1',
        excludedFolderIds: ['folder-2'],
      }),
    ).toBe(true)
  })

  it('treats an excluded id that no longer matches any folder as a no-op — the document that used to live there is at the root by then', () => {
    // A folder being deleted moves its documents to root (`folderId: null`)
    // — see `features/documents/model/documents.ts`'s `deleteFolderFx`.
    // The stale id can still sit in `excludedFolderIds` (nothing prunes
    // it), but it can never match a real document's `documentFolderId`
    // again, so this is just the root case again.
    expect(
      isWordCompletionActive({
        ...BASE,
        documentFolderId: null,
        excludedFolderIds: ['deleted-folder-id'],
      }),
    ).toBe(true)
  })
})

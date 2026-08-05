import { createEvent, createStore } from 'effector'

import type { GitHubOrigin } from '@/features/documents'

/**
 * The live mirror of every local document/folder this feature needs to
 * drive sync — projected down from `@/features/documents`'s stores by
 * `src/app/wiring.ts` (`documents` never imports `github`, same rule as
 * every other cross-feature link in this app), and read by both
 * `model/sync.ts` (the push engine) and `model/import.ts` (first-connect
 * import's "already linked?" de-dup check). Split into its own module
 * specifically so those two files can both depend on it without depending on
 * each other — `sync.ts` triggers a push after an import completes, so it
 * already imports from `import.ts`; the reverse dependency would be a cycle.
 */

export interface SyncDocInput {
  id: string
  title: string
  content: string
  folderId: string | null
  origin: GitHubOrigin | null
}

export interface SyncFolderInput {
  id: string
  name: string
  syncDirPath: string | null
}

export const documentsSnapshotChanged = createEvent<SyncDocInput[]>()
export const foldersSnapshotChanged = createEvent<SyncFolderInput[]>()

export const $documentsSnapshot = createStore<SyncDocInput[]>([]).on(
  documentsSnapshotChanged,
  (_, docs) => docs,
)
export const $foldersSnapshot = createStore<SyncFolderInput[]>([]).on(
  foldersSnapshotChanged,
  (_, folders) => folders,
)

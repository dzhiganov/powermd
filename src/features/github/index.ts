export { default as GitHubModal } from './ui/GitHubModal.vue'
export { default as SyncStatusIndicator } from './ui/SyncStatusIndicator.vue'

export { initGithub } from './model/connection'

// GitHub sync modal open/close — reachable from `layout/ui/MoreMenu.vue`'s
// "GitHub sync" item and from `SyncStatusIndicator.vue` itself.
export { githubModalOpened } from './model/dialog'

// Cross-feature links wired in `src/app/wiring.ts` (documents <-> github, one
// directional: `github` may import `@/features/documents`'s public API for
// the `GitHubOrigin` type; `documents` never imports `github`).
export {
  documentsSnapshotChanged,
  foldersSnapshotChanged,
  type SyncDocInput,
  type SyncFolderInput,
} from './model/snapshot'
export { importCompleted, type BulkImportDoc } from './model/import'
export { originsAssigned, folderDirsAssigned, pushCompleted } from './model/sync'

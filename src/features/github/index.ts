export { default as GitHubSyncPanel } from './ui/GitHubSyncPanel.vue'
export { default as SyncStatusIndicator } from './ui/SyncStatusIndicator.vue'

export { initGithub } from './model/connection'

// Fired by `SyncStatusIndicator.vue`; resolved in `src/app/wiring.ts` into
// `features/settings`' `settingsOpened('sync')` — see
// `model/settingsPanel.ts`'s own doc comment for why this is a plain intent
// event rather than a direct cross-feature import.
export { githubSettingsRequested } from './model/settingsPanel'

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

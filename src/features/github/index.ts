export { default as GitHubButton } from './ui/GitHubButton.vue'
export { default as GitHubModal } from './ui/GitHubModal.vue'
export { default as CommitDialog } from './ui/CommitDialog.vue'

export { initGithub } from './model/connection'

// GitHub sync modal open/close — was only reachable from `GitHubButton.vue`
// (an internal, relative import within this feature) before the Phase 2
// visual redesign; `layout/ui/MoreMenu.vue`'s "GitHub sync" item needs to
// open the same modal from outside the feature, hence exporting it here.
export { githubModalOpened } from './model/dialog'

// Cross-feature links wired in `src/app/wiring.ts` (github -> documents).
export { fileOpened } from './model/fileOpen'
export {
  commitSucceeded,
  remoteReloadRequested,
  activeDocumentForCommitChanged,
  commitDialogOpened,
  $activeDocumentForCommit,
} from './model/commit'

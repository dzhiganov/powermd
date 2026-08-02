export { default as GitHubButton } from './ui/GitHubButton.vue'
export { default as GitHubModal } from './ui/GitHubModal.vue'
export { default as CommitDialog } from './ui/CommitDialog.vue'

export { initGithub } from './model/connection'

// Cross-feature links wired in `src/app/wiring.ts` (github -> documents).
export { fileOpened } from './model/fileOpen'
export {
  commitSucceeded,
  remoteReloadRequested,
  activeDocumentForCommitChanged,
  commitDialogOpened,
  $activeDocumentForCommit,
} from './model/commit'

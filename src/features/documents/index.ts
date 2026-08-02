export { default as DocumentDrawer } from './ui/DocumentDrawer.vue'
export { default as DrawerToggleButton } from './ui/DrawerToggleButton.vue'
export { default as DocumentTitle } from './ui/DocumentTitle.vue'
export { default as SaveIndicator } from './ui/SaveIndicator.vue'

export {
  initDocuments,
  activeDocumentEdited,
  activeDocumentLoaded,
  documentImported,
  documentOpenedFromOrigin,
  documentGithubSynced,
  documentRemoteApplied,
  documentSelected,
  documentCreated,
  documentDuplicated,
  documentMoveRequested,
  drawerClosed,
  saveRequested,
  autosaveIntervalChanged,
  folderCreated,
  folderRenamed,
  folderDeleteRequested,
  folderDeleteConfirmed,
  folderDeleteCancelled,
  folderCollapseToggled,
  $activeId,
  $activeDocument,
  $folders,
  $dbBlocked,
} from './model/documents'

export type { MarkdownDocument, SaveStatus, Folder, GitHubOrigin } from './model/types'

export { default as DocumentDrawer } from './ui/DocumentDrawer.vue'
export { default as DrawerToggleButton } from './ui/DrawerToggleButton.vue'
export { default as DocumentTitle } from './ui/DocumentTitle.vue'
export { default as SaveIndicator } from './ui/SaveIndicator.vue'

export {
  initDocuments,
  activeDocumentEdited,
  activeDocumentLoaded,
  documentImported,
  documentsBulkImported,
  documentGithubOriginsApplied,
  folderSyncDirPathsApplied,
  documentSelected,
  documentCreated,
  documentDuplicated,
  documentMoveRequested,
  drawerOpened,
  drawerClosed,
  $drawerOpen,
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
  $documentList,
  $folders,
  $dbBlocked,
} from './model/documents'

export {
  searchQueryChanged,
  searchCleared,
  searchFocusRequested,
  $searchQuery,
  $isSearching,
  $searchResults,
} from './model/search'

export type { MarkdownDocument, SaveStatus, Folder, GitHubOrigin } from './model/types'
export type { SearchResult, SearchMatchLocation } from './lib/search'

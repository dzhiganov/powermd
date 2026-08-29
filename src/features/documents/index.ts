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

// Highlight STORAGE only. This feature owns `lib/db.ts`, so the `highlights`
// feature cannot reach the database itself — it has these injected instead
// (see `app/highlights.ts`). Deliberately no `Highlight` type and no
// behaviour: `documents` stores highlight rows, it does not know what a
// highlight means.
export {
  getHighlightsForDocument as loadHighlightsForDocument,
  putHighlights as saveHighlights,
  deleteHighlights as removeHighlights,
} from './lib/db'

export type { MarkdownDocument, SaveStatus, Folder, GitHubOrigin } from './model/types'
export type { SearchResult, SearchMatchLocation } from './lib/search'

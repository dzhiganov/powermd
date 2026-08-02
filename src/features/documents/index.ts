export { default as DocumentDrawer } from './ui/DocumentDrawer.vue'
export { default as DrawerToggleButton } from './ui/DrawerToggleButton.vue'
export { default as DocumentTitle } from './ui/DocumentTitle.vue'
export { default as SaveIndicator } from './ui/SaveIndicator.vue'

export {
  initDocuments,
  activeDocumentEdited,
  activeDocumentLoaded,
  documentImported,
  documentSelected,
  documentCreated,
  documentDuplicated,
  drawerClosed,
  saveRequested,
  autosaveIntervalChanged,
  $activeId,
  $activeDocument,
} from './model/documents'

export type { MarkdownDocument, SaveStatus } from './model/types'

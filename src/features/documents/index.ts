export { default as DocumentDrawer } from './ui/DocumentDrawer.vue'
export { default as DocumentMenuButton } from './ui/DocumentMenuButton.vue'
export { default as SaveIndicator } from './ui/SaveIndicator.vue'

export {
  initDocuments,
  activeDocumentEdited,
  activeDocumentLoaded,
  $activeId,
  $activeDocument,
} from './model/documents'

export type { MarkdownDocument, SaveStatus } from './model/types'

export { default as HighlightsPanel } from './ui/HighlightsPanel.vue'
export { default as HighlightToolbar } from './ui/HighlightToolbar.vue'
export {
  initHighlights,
  activeDocumentChanged,
  selectionChanged,
  highlightClicked,
  rangesRemapped,
  documentTextChanged,
  panelToggled,
  $highlights,
  $highlightCount,
  $panelOpen,
} from './model/highlights'
export type { Highlight, HighlightsDeps, SelectionInfo } from './model/highlights'

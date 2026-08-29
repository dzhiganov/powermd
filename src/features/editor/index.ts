export { default as Editor } from './ui/Editor.vue'
export { default as FormattingToolbar } from './ui/FormattingToolbar.vue'
export { default as WordCount } from './ui/WordCount.vue'
export { $content, contentChanged, loadContent, WELCOME_CONTENT } from './model/content'
export { $editorScrollHandle } from './model/scrollHandle'
export type { EditorScrollHandle, EditorLineBlock } from './model/scrollHandle'
export {
  saveNowRequested,
  viewModeCycleRequested,
  helpRequested,
  lineWrapChanged,
  editorFontMetricsChanged,
  spellcheckSettingsChanged,
  wikiLinkDocumentsChanged,
  activeWikiLinkDocumentIdChanged,
  wordCompletionChanged,
  focusModeChanged,
} from './model/editorEvents'
export { taskListItemToggleRequested } from './model/taskList'
export {
  editorHighlightsChanged,
  $editorSelection,
  editorHighlightsRemapped,
  editorHighlightClicked,
} from './model/highlights'
export type { EditorSelectionInfo } from './model/highlights'
export type { EditorHighlight } from './lib/highlightDecorations'
export type { AnchoredRange, RemapResult } from './lib/highlightRanges'
export { EDITOR_SHORTCUTS } from './lib/shortcuts'
export type { EditorShortcut } from './lib/shortcuts'
export type { WikiLinkDocument } from './lib/wikiLinkCompletion'

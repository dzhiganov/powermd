export { default as ThemeToggle } from './ui/ThemeToggle.vue'
export { $theme, themeCycled, cycleTheme } from './model/theme'

export { default as SettingsButton } from './ui/SettingsButton.vue'
export { default as SettingsModal } from './ui/SettingsModal.vue'
export { default as HelpButton } from './ui/HelpButton.vue'
export { default as ShortcutsModal } from './ui/ShortcutsModal.vue'

export {
  $editorFontSize,
  $editorFontFamily,
  $lineWrapEnabled,
  $autosaveDebounceMs,
  $readingWidthCh,
  $spellCheckEnabled,
  $spellCheckLanguage,
  $wordCompletionEnabled,
  $wordCompletionExcludedFolderIds,
  $focusModeEnabled,
  editorFontSizeChanged,
  editorFontFamilyChanged,
  lineWrapToggled,
  autosaveDebounceChanged,
  readingWidthChanged,
  spellCheckToggled,
  spellCheckLanguageChanged,
  wordCompletionToggled,
  wordCompletionFolderExclusionToggled,
  focusModeToggled,
  SPELLCHECK_LANGUAGES,
} from './model/editorPreferences'
export type { EditorFontFamily, SpellCheckLanguage } from './model/editorPreferences'

export { $documentFolders, documentFoldersChanged } from './model/folderMirror'
export type { DocumentFolder } from './model/folderMirror'

export {
  $settingsOpen,
  $settingsInitialCategory,
  $helpOpen,
  settingsOpened,
  settingsClosed,
  helpOpened,
  helpClosed,
} from './model/dialogs'
export type { SettingsCategory } from './model/dialogs'

export {
  $showTooltips,
  showTooltipsToggled,
  $drawerSide,
  drawerSideChanged,
  $showFormattingToolbar,
  showFormattingToolbarToggled,
  $scrollSyncEnabled,
  scrollSyncToggled,
  $autoSyncIntervalMinutes,
  autoSyncIntervalMinutesChanged,
  AUTO_SYNC_INTERVAL_MINUTES_OPTIONS,
} from './model/uiPreferences'
export type { DrawerSide, AutoSyncIntervalMinutes } from './model/uiPreferences'

export { default as ThemeToggle } from './ui/ThemeToggle.vue'
export { $theme, themeToggled, toggleTheme } from './model/theme'

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
  editorFontSizeChanged,
  editorFontFamilyChanged,
  lineWrapToggled,
  autosaveDebounceChanged,
  readingWidthChanged,
} from './model/editorPreferences'
export type { EditorFontFamily } from './model/editorPreferences'

export {
  $settingsOpen,
  $helpOpen,
  settingsOpened,
  settingsClosed,
  helpOpened,
  helpClosed,
} from './model/dialogs'

export {
  $showTooltips,
  showTooltipsToggled,
  $drawerSide,
  drawerSideChanged,
  $showFormattingToolbar,
  showFormattingToolbarToggled,
} from './model/uiPreferences'
export type { DrawerSide } from './model/uiPreferences'

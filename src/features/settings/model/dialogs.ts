import { createEvent, createStore } from 'effector'

/** Settings modal open state — see `ui/SettingsModal.vue`, triggered from
 * `ui/SettingsButton.vue`. */
export const settingsOpened = createEvent()
export const settingsClosed = createEvent()
export const $settingsOpen = createStore(false)
  .on(settingsOpened, () => true)
  .on(settingsClosed, () => false)

/** Keyboard-shortcuts help modal open state — see `ui/ShortcutsModal.vue`,
 * triggered from `ui/HelpButton.vue` or the editor's Mod-/ binding (via
 * `src/app/wiring.ts`, since `features/editor` doesn't know this feature
 * exists). */
export const helpOpened = createEvent()
export const helpClosed = createEvent()
export const $helpOpen = createStore(false)
  .on(helpOpened, () => true)
  .on(helpClosed, () => false)

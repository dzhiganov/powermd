import { createEvent, createStore } from 'effector'

/** The three settings categories — see `ui/SettingsModal.vue`'s own
 * category-nav doc comment. */
export type SettingsCategory = 'editor' | 'appearance' | 'github'

export const DEFAULT_SETTINGS_CATEGORY: SettingsCategory = 'editor'

/** Settings modal open state — see `ui/SettingsModal.vue`, triggered from
 * `ui/SettingsButton.vue`, `layout/ui/MoreMenu.vue`'s "Settings" item
 * (always `undefined` — opens on the default category), and
 * `src/app/wiring.ts`'s resolution of `features/github`'s
 * `githubSettingsRequested` (always `'github'` — jumps straight to that
 * category). Effector's `EventCallable` requires the argument to be passed
 * explicitly once the payload type isn't plain `void`, even when it's
 * `undefined` — every call site does. */
export const settingsOpened = createEvent<SettingsCategory | undefined>()
export const settingsClosed = createEvent()
export const $settingsOpen = createStore(false)
  .on(settingsOpened, () => true)
  .on(settingsClosed, () => false)

/** Which category the dialog should land on the moment it opens — read
 * once by `ui/SettingsModal.vue`'s own `watch(open, ...)`, the same
 * "seed from a store snapshot when a boolean flips true" shape as
 * `useDialogFocusTrap`'s trigger-element capture. Deliberately not the
 * dialog's *current* category the way `$settingsOpen` is: switching
 * categories while the dialog is open must never retroactively change
 * what a fresh `settingsOpened(undefined)` call defaults to next time. */
export const $settingsInitialCategory = createStore<SettingsCategory>(DEFAULT_SETTINGS_CATEGORY).on(
  settingsOpened,
  (_, category) => category ?? DEFAULT_SETTINGS_CATEGORY,
)

/** Keyboard-shortcuts help modal open state — see `ui/ShortcutsModal.vue`,
 * triggered from `ui/HelpButton.vue` or the editor's Mod-/ binding (via
 * `src/app/wiring.ts`, since `features/editor` doesn't know this feature
 * exists). */
export const helpOpened = createEvent()
export const helpClosed = createEvent()
export const $helpOpen = createStore(false)
  .on(helpOpened, () => true)
  .on(helpClosed, () => false)

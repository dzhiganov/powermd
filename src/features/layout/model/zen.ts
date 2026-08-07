import { createEvent, createStore } from 'effector'

/**
 * Distraction-free mode: hides the header, sidebar, and every other piece
 * of app chrome, leaving only the active pane's text on screen. A single
 * global store (not a per-component `ref`) so any part of the app can read
 * it — `ui/AppShell.vue` (chrome visibility), `ui/EditorPane.vue` (the
 * formatting toolbar), `ui/Toolbar.vue`/`ui/ZenExitButton.vue` (the
 * toggle/exit affordances), and `src/app/zenShortcut.ts` (the app-wide
 * keyboard shortcut + Escape-to-exit) all read or write it the same way.
 *
 * Deliberately NOT persisted — no `readStorage`/`writeStorage`, and no
 * `defaultsRestored` reducer (contrast every store in `features/settings/
 * model/editorPreferences.ts`/`uiPreferences.ts`) — a reload must always
 * come back with chrome visible; nothing here should ever re-enter zen mode
 * on its own.
 */
export const zenToggled = createEvent()
export const zenExited = createEvent()
export const $zenMode = createStore(false)
  .on(zenToggled, (enabled) => !enabled)
  .on(zenExited, () => false)

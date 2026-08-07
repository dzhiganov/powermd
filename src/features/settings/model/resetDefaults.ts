import { createEvent, createStore, sample } from 'effector'

/** "Reset to defaults" confirmation-dialog open state, triggered from the
 * button in `ui/SettingsModal.vue` — same open/close store shape as
 * `$settingsOpen`/`$helpOpen` in `model/dialogs.ts`, kept in its own file
 * since (unlike those) it also owns the actual reset broadcast below. */
export const resetRequested = createEvent()
export const resetConfirmed = createEvent()
export const resetCancelled = createEvent()
export const $resetConfirmOpen = createStore(false)
  .on(resetRequested, () => true)
  .on(resetConfirmed, () => false)
  .on(resetCancelled, () => false)

/**
 * Fired once the user confirms "Reset to defaults". Every persisted
 * preference store in this feature — `theme.ts`'s `$theme`,
 * `editorPreferences.ts`'s font size/family/line wrap/autosave/reading
 * width, `uiPreferences.ts`'s tooltips/drawer side/formatting toolbar/
 * scroll sync/auto-sync interval — adds its own
 * `.on(defaultsRestored, () => DEFAULT)` reducer
 * directly in its own file, rather than this file reaching into every store
 * and setting values by hand. That keeps "reset" automatically in sync with
 * "persist": a preference added to any of those files later is covered by
 * both just by being a store with a default, nothing to remember to wire up
 * here. Each store's own `persistFx`/`applyXFx` (already sampled off the
 * store itself) then re-persists and re-applies the reset value the same
 * way it does any other change — no extra wiring needed for "applies
 * immediately and persists" either.
 *
 * Deliberately does NOT touch documents, folders, or the GitHub
 * connection/token: those are owned by `features/documents`/
 * `features/github`, which this feature never imports (see
 * ARCHITECTURE.md's boundaries) — so there is no code path by which this
 * event could reach them even by accident.
 */
export const defaultsRestored = createEvent()

sample({ clock: resetConfirmed, target: defaultsRestored })

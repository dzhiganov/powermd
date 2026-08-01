import { createEvent, createStore } from 'effector'

/** Fired by the editor's Mod-S binding (see `lib/shortcuts.ts`) — save
 * immediately, bypassing the documents feature's autosave debounce.
 * Consumed in `src/app/wiring.ts`, the one place allowed to know both
 * `editor` and `documents` exist. */
export const saveNowRequested = createEvent()

/** Fired by Mod-Shift-V — cycle the toolbar's view-mode switcher
 * (editor -> split -> preview -> editor). The editor feature doesn't know
 * `layout` exists; wiring.ts resolves the actual next mode. */
export const viewModeCycleRequested = createEvent()

/** Fired by Mod-/ — open the keyboard-shortcuts help modal, owned by
 * `features/settings`. Consumed in wiring.ts. */
export const helpRequested = createEvent()

/**
 * The editor feature's own mirror of `features/settings`' persisted
 * line-wrap preference. `Editor.vue` reads this both for the CodeMirror
 * Compartment's *initial* extension (see `lib/useCodeMirror.ts`) and to
 * react to later changes by reconfiguring that Compartment live — never a
 * state rebuild, so undo history and cursor position survive a toggle.
 *
 * Defaults to `true` (line wrap was unconditionally on before this
 * preference existed) so the editor behaves exactly as before until
 * wiring.ts has had a chance to apply the real persisted value — which it
 * does synchronously, before this module's default could ever paint.
 */
export const lineWrapChanged = createEvent<boolean>()
export const $lineWrapEnabled = createStore<boolean>(true).on(
  lineWrapChanged,
  (_, enabled) => enabled,
)

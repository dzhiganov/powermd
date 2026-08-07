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

/**
 * Fired whenever `features/settings`' persisted editor font size or font
 * family preference changes (`wiring.ts` mirrors it in — same
 * "settings owns the preference, the acting feature keeps its own mirror"
 * shape as `lineWrapChanged` above). `Editor.vue` doesn't need the
 * *value*: both preferences are already applied purely via CSS custom
 * properties (`--md-editor-font-size`/`-family` on `<html>`, read by
 * `.cm-scroller`'s inline theme styles in `lib/theme.ts`), no Compartment
 * involved. This event is only a signal to call
 * `EditorView.requestMeasure()` afterwards: CodeMirror's internal height
 * map (cursor placement, scroll-into-view, `scroll-sync`'s proportional
 * mapping) is keyed off measured line height, and a font-metric change
 * never touches the editor's *container* — the one thing the existing
 * `ResizeObserver` in `lib/useCodeMirror.ts` watches — so without this the
 * height map goes stale. Same failure mode already documented there for
 * the self-hosted font's async load (measured ~85% off before that fix).
 */
export const editorFontMetricsChanged = createEvent()

/**
 * The editor feature's own mirror of `features/settings`'s persisted spell
 * check preferences (enabled + language) — same "settings owns the
 * preference, the acting feature keeps its own mirror" shape as
 * `$lineWrapEnabled` above. Bundled into one event/store (rather than two,
 * mirroring `$lineWrapEnabled`/`editorFontMetricsChanged` separately) since
 * `Editor.vue`'s `setSpellcheck` (see `lib/useCodeMirror.ts`) always needs
 * both values together to build the content element's `spellcheck`/`lang`
 * attributes in one reconfigure.
 *
 * Defaults to spell check on, no language override — the same behaviour
 * the editor had before this preference existed (`spellcheck: 'true'`,
 * `lang` following the page) — so it renders correctly before `wiring.ts`
 * has applied the real persisted value, which it does synchronously before
 * this module's default could ever paint.
 */
export const spellcheckSettingsChanged = createEvent<{ enabled: boolean; language: string }>()
export const $spellcheckSettings = createStore<{ enabled: boolean; language: string }>({
  enabled: true,
  language: 'default',
}).on(spellcheckSettingsChanged, (_, settings) => settings)

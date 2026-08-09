import { createEffect, createEvent, createStore, sample } from 'effector'

import { readStorage, writeStorage } from '@/shared/lib/storage'
import { defaultsRestored } from './resetDefaults'

/** Must match the storage key hardcoded in the anti-flash inline script in
 * index.html — same reasoning as `shared/config/theme.ts`'s
 * `THEME_STORAGE_KEY`: that script runs before any JS module loads and
 * can't import this constant, so keep the two in sync by hand. Lives in its
 * own model file (rather than alongside the plain toggles in
 * `uiPreferences.ts`) because, like the theme choice, it's applied to
 * `<html>` before first paint — every other preference in
 * `uiPreferences.ts` only ever applies post-hydration. */
export const SOFT_CONTRAST_STORAGE_KEY = 'markdown-editor:soft-contrast'

const DEFAULT_SOFT_CONTRAST = false

function readInitialSoftContrast(): boolean {
  const stored = readStorage(SOFT_CONTRAST_STORAGE_KEY)
  return stored === 'true'
}

/** Fired when the user toggles "Soft contrast" in Settings > Appearance. */
export const softContrastToggled = createEvent()

/**
 * Independent of the light/dark theme choice — applies to whichever theme
 * is active, softening that theme's surface tokens toward its own text
 * colour (dark near-black -> dark grey, light near-white -> light grey; see
 * `app/styles/main.css`'s `[data-soft='true']` overrides). Off by default.
 */
export const $softContrast = createStore<boolean>(readInitialSoftContrast())
  .on(softContrastToggled, (enabled) => !enabled)
  .on(defaultsRestored, () => DEFAULT_SOFT_CONTRAST)

const persistSoftContrastFx = createEffect((enabled: boolean) => {
  writeStorage(SOFT_CONTRAST_STORAGE_KEY, String(enabled))
})

// Applied as `data-soft="true"|"false"` on <html>, alongside `data-theme` —
// the same attribute-driven mechanism `theme.ts`'s `applyThemeFx` uses, so
// CSS does all the repainting with no per-component JS needed anywhere
// downstream. Always written as an explicit "true"/"false" string (never
// just added/omitted) so `main.css`'s `[data-soft='true']` selector is the
// only state CSS ever has to reason about — no separate "attribute absent"
// falsy case to also handle.
const applySoftContrastFx = createEffect((enabled: boolean) => {
  document.documentElement.setAttribute('data-soft', String(enabled))
})

// Two separate `sample`s (not one effect run twice, not a combined target
// array) — mirrors `theme.ts`'s own `persistThemeFx`/`applyThemeFx` split
// exactly, for the same reason: persistence and DOM application are
// independent concerns that happen to both react to the same store.
// Neither touches `document`/`window` at module-eval time: the anti-flash
// inline script in index.html has already set `data-soft` before first
// paint, and `$softContrast` itself initialises synchronously above, so
// there's no race and no need for an eager kick the way
// `editorPreferences.ts`'s CSS-variable effect needs one (that preference
// has no pre-paint script counterpart to already have applied it).
sample({ clock: $softContrast, target: persistSoftContrastFx })
sample({ clock: $softContrast, target: applySoftContrastFx })

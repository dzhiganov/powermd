import { combine, createEffect, createEvent, createStore, sample } from 'effector'

import { readStorage, writeStorage } from '@/shared/lib/storage'
import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  THEMES,
  type ResolvedTheme,
  type Theme,
} from '@/shared/config/theme'
import { defaultsRestored } from './resetDefaults'

function isTheme(value: string | null): value is Theme {
  return value === THEMES.light || value === THEMES.dark || value === THEMES.system
}

function readInitialTheme(): Theme {
  const stored = readStorage(THEME_STORAGE_KEY)
  return isTheme(stored) ? stored : DEFAULT_THEME
}

const THEME_CYCLE: Record<Theme, Theme> = {
  [THEMES.light]: THEMES.dark,
  [THEMES.dark]: THEMES.system,
  [THEMES.system]: THEMES.light,
}

export function cycleTheme(current: Theme): Theme {
  return THEME_CYCLE[current]
}

/** Fired when the user asks to cycle the theme (light -> dark -> system ->
 * light). Carries no payload — the component only reports intent, the model
 * decides the next value. */
export const themeCycled = createEvent()

/** The user's persisted *choice* ('light' | 'dark' | 'system') — never the
 * resolved value. Persisting the choice (rather than resolving 'system' at
 * write time) is what lets it keep following the OS preference across
 * reloads instead of freezing at whatever it resolved to once. */
export const $theme = createStore<Theme>(readInitialTheme())
  .on(themeCycled, cycleTheme)
  .on(defaultsRestored, () => DEFAULT_THEME)

// --- Resolve 'system' against the live OS preference -----------------------
//
// `$theme` only ever holds the user's choice; this section turns that
// choice into the concrete 'light'/'dark' value the rest of the app
// (daisyUI's `data-theme`, `features/preview/lib/mermaidTheme.ts`) actually
// understands, and keeps it live: `prefersDarkQuery`'s `change` listener is
// registered once here, at module load, for the lifetime of the page — not
// inside a component — so the resolved theme keeps tracking the OS even if
// no component that cares is currently mounted.
const prefersDarkQuery =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null

const osPreferenceChanged = createEvent<boolean>()

/** Mirrors the OS-level dark/light preference. Only `$resolvedTheme` below
 * reads it, and only while `$theme` is 'system' — 'light'/'dark' choices
 * ignore it entirely. */
const $prefersDark = createStore<boolean>(prefersDarkQuery?.matches ?? false).on(
  osPreferenceChanged,
  (_, prefersDark) => prefersDark,
)

prefersDarkQuery?.addEventListener('change', (event) => {
  osPreferenceChanged(event.matches)
})

/** Always 'light' or 'dark', never the literal string 'system' — this is
 * what actually gets written to `<html data-theme>` below. Recomputes (and,
 * via the `sample` further down, re-applies to the DOM) the instant either
 * `$theme` or `$prefersDark` changes, so a live OS-preference flip while
 * `$theme === 'system'` repaints immediately with no reload needed. */
const $resolvedTheme = combine($theme, $prefersDark, (theme, prefersDark): ResolvedTheme =>
  theme === THEMES.system ? (prefersDark ? THEMES.dark : THEMES.light) : theme,
)

// Persist every choice change and apply the resolved theme to
// <html data-theme="..."> so DaisyUI picks it up. Both run as effects (not
// `.watch`) so neither ever touches `document`/`window` at module-eval time
// beyond the `matchMedia` call above — the initial resolved theme is already
// applied by the anti-flash inline script in index.html, and `$theme`/
// `$resolvedTheme` still initialise synchronously above, so there's no race
// and no need to eagerly re-apply what the inline script already set.
const persistThemeFx = createEffect((theme: Theme) => {
  writeStorage(THEME_STORAGE_KEY, theme)
})

const applyThemeFx = createEffect((theme: ResolvedTheme) => {
  document.documentElement.setAttribute('data-theme', theme)
})

sample({ clock: $theme, target: persistThemeFx })
sample({ clock: $resolvedTheme, target: applyThemeFx })

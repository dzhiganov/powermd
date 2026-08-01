import { createEffect, createEvent, createStore, sample } from 'effector'

import { readStorage, writeStorage } from '@/shared/lib/storage'
import { DEFAULT_THEME, THEME_STORAGE_KEY, THEMES, type Theme } from '@/shared/config/theme'

function isTheme(value: string | null): value is Theme {
  return value === THEMES.light || value === THEMES.dark
}

function readInitialTheme(): Theme {
  const stored = readStorage(THEME_STORAGE_KEY)
  return isTheme(stored) ? stored : DEFAULT_THEME
}

export function toggleTheme(current: Theme): Theme {
  return current === THEMES.light ? THEMES.dark : THEMES.light
}

/** Fired when the user asks to toggle the theme. Carries no payload — the
 * component only reports intent, the model decides the next value. */
export const themeToggled = createEvent()

export const $theme = createStore<Theme>(readInitialTheme()).on(themeToggled, toggleTheme)

// Persist every change and apply it to <html data-theme="..."> so DaisyUI
// picks it up. Runs as an effect (not a `.watch`) so it never touches
// `document` at module-eval time — the initial theme is already applied
// by the anti-flash inline script in index.html, and `$theme` itself still
// initialises synchronously from localStorage above, so there's no race.
const applyThemeFx = createEffect((theme: Theme) => {
  writeStorage(THEME_STORAGE_KEY, theme)
  document.documentElement.setAttribute('data-theme', theme)
})

sample({
  clock: $theme,
  target: applyThemeFx,
})

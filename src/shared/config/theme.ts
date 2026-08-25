// Must match the storage key hardcoded in the anti-flash inline script in
// index.html — that script runs before any JS module loads and can't
// import this constant, so keep the two in sync by hand. The stored value
// is one of THEMES' four keys below ('light' | 'dark' | 'system' |
// 'schedule') — the inline script resolves 'system' against
// `prefers-color-scheme` and 'schedule' against the two schedule-time keys
// (`SCHEDULE_LIGHT_TIME_KEY`/`SCHEDULE_DARK_TIME_KEY`, see
// `features/settings/model/theme.ts`) itself, the same way
// `features/settings/model/theme.ts`'s `$resolvedTheme` does after
// hydration — anything missing/invalid falls back to the 'system'
// resolution.
export const THEME_STORAGE_KEY = 'markdown-editor:theme'

export const THEMES = {
  light: 'light',
  dark: 'dark',
  system: 'system',
  /** A fourth mode alongside the three above, not a separate system next to
   * them: the user picks two clock times (light starts / dark starts) in
   * Settings > Appearance, and the resolved theme follows whichever side of
   * that schedule the current time falls on — see `features/settings/lib/
   * themeSchedule.ts` for the resolution logic and `$resolvedTheme` in
   * `features/settings/model/theme.ts` for how it's wired in alongside
   * 'system's own `prefers-color-scheme` resolution. */
  schedule: 'schedule',
} as const

/** The user's persisted *choice*. Stored and exposed by `$theme` — see
 * `features/settings/model/theme.ts`. */
export type Theme = (typeof THEMES)[keyof typeof THEMES]

/** What's actually applied to `<html data-theme>` — 'system' and 'schedule'
 * are both always resolved away before they reach the DOM (daisyUI/
 * `mermaidTheme.ts` only know 'light'/'dark'). See `$resolvedTheme` in
 * `features/settings/model/theme.ts`. */
export type ResolvedTheme = typeof THEMES.light | typeof THEMES.dark

// 'system' — not 'light' — so that a fresh/cleared origin (nothing stored
// yet) resolves the same way whether or not JS has hydrated: the anti-flash
// inline script in index.html always falls back to `prefers-color-scheme`
// when nothing valid is stored, with no notion of a separate hardcoded
// default. A hardcoded 'light' default here would silently disagree with
// that the moment the OS preference is dark — the inline script would paint
// dark before JS loads, then `$theme`/`$resolvedTheme` would compute
// 'light' once this module evaluates, without ever repainting to match (no
// eager `applyThemeFx` call — see the comment on the `sample`s at the
// bottom of `theme.ts`), leaving the toggle's icon/label silently
// contradicting the painted theme until the next actual change.
export const DEFAULT_THEME: Theme = THEMES.system

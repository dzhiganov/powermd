// Must match the storage key hardcoded in the anti-flash inline script in
// index.html — that script runs before any JS module loads and can't
// import this constant, so keep the two in sync by hand. The stored value
// is one of THEMES' three keys below ('light' | 'dark' | 'system') — the
// inline script resolves 'system' against `prefers-color-scheme` itself,
// the same way `features/settings/model/theme.ts`'s `$resolvedTheme` does
// after hydration — anything missing/invalid falls back to the 'system'
// resolution.
//
// That "invalid falls back" branch is load-bearing beyond first visits: a
// fourth 'schedule' mode used to exist and is still sitting in the storage
// of every origin that selected it. It is now simply not one of the keys
// below, so both this app's own read (`isTheme` in
// `features/settings/model/theme.ts`) and the inline script's read treat it
// as absent and land on the same 'system' resolution — no migration step,
// no stale value that nothing can resolve.
export const THEME_STORAGE_KEY = 'markdown-editor:theme'

export const THEMES = {
  light: 'light',
  dark: 'dark',
  system: 'system',
} as const

/** The user's persisted *choice*. Stored and exposed by `$theme` — see
 * `features/settings/model/theme.ts`. */
export type Theme = (typeof THEMES)[keyof typeof THEMES]

/** What's actually applied to `<html data-theme>` — 'system' is always
 * resolved away before it reaches the DOM (daisyUI/`mermaidTheme.ts` only
 * know 'light'/'dark'). See `$resolvedTheme` in
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

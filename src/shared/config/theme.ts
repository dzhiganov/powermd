// Must match the storage key hardcoded in the anti-flash inline script in
// index.html — that script runs before any JS module loads and can't
// import this constant, so keep the two in sync by hand.
export const THEME_STORAGE_KEY = 'markdown-editor:theme'

export const THEMES = {
  light: 'light',
  dark: 'dark',
} as const

export type Theme = (typeof THEMES)[keyof typeof THEMES]

export const DEFAULT_THEME: Theme = THEMES.light

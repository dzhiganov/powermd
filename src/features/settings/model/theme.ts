import { combine, createEffect, createEvent, createStore, sample } from 'effector'

import { readStorage, writeStorage } from '@/shared/lib/storage'
import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  THEMES,
  type ResolvedTheme,
  type Theme,
} from '@/shared/config/theme'
import { isTimeOfDay, nextScheduleBoundary, resolveScheduledTheme } from '../lib/themeSchedule'
import { defaultsRestored } from './resetDefaults'

function isTheme(value: string | null): value is Theme {
  return (
    value === THEMES.light ||
    value === THEMES.dark ||
    value === THEMES.system ||
    value === THEMES.schedule
  )
}

function readInitialTheme(): Theme {
  const stored = readStorage(THEME_STORAGE_KEY)
  return isTheme(stored) ? stored : DEFAULT_THEME
}

const THEME_CYCLE: Record<Theme, Theme> = {
  [THEMES.light]: THEMES.dark,
  [THEMES.dark]: THEMES.system,
  [THEMES.system]: THEMES.schedule,
  [THEMES.schedule]: THEMES.light,
}

export function cycleTheme(current: Theme): Theme {
  return THEME_CYCLE[current]
}

/** Fired when the user asks to cycle the theme (light -> dark -> system ->
 * schedule -> light). Carries no payload — the component only reports
 * intent, the model decides the next value. */
export const themeCycled = createEvent()

/** Fired by Settings > Appearance's theme mode buttons — a direct "set to
 * exactly this" pick, unlike `themeCycled`'s one-step-at-a-time cycle
 * (`ui/ThemeToggle.vue`'s header button). Reaching 'schedule' by cycling
 * alone takes up to three clicks from 'light'; this gives the segmented
 * control in Settings a one-click path to any of the four modes. */
export const themeChanged = createEvent<Theme>()

/** The user's persisted *choice* ('light' | 'dark' | 'system' | 'schedule')
 * — never the resolved value. Persisting the choice (rather than resolving
 * 'system'/'schedule' at write time) is what lets it keep following the OS
 * preference / the clock across reloads instead of freezing at whatever it
 * resolved to once. */
export const $theme = createStore<Theme>(readInitialTheme())
  .on(themeCycled, cycleTheme)
  .on(themeChanged, (_, theme) => theme)
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

// --- Schedule mode: two persisted clock times -------------------------------
//
// The "Schedule" mode's own settings — a light-starts and a dark-starts
// time of day (`HH:MM`, `<input type="time">`'s native format — see
// `ui/SettingsModal.vue`'s two time inputs), read/persisted the same shape
// as every other preference in this feature (`model/editorPreferences.ts`),
// consumed by `resolveScheduledTheme` (`lib/themeSchedule.ts`) below.

// Must match the storage keys hardcoded in the anti-flash inline script in
// index.html — the same "kept in sync by hand" arrangement `shared/config/
// theme.ts`'s `THEME_STORAGE_KEY` documents, for the same reason: that
// script runs before any JS module loads and can't import these constants.
// The two DEFAULT_* values below must also match the literal fallback
// strings hardcoded there.
const SCHEDULE_LIGHT_TIME_KEY = 'markdown-editor:schedule-light-time'
const SCHEDULE_DARK_TIME_KEY = 'markdown-editor:schedule-dark-time'

const DEFAULT_SCHEDULE_LIGHT_TIME = '07:00'
const DEFAULT_SCHEDULE_DARK_TIME = '19:00'

function readScheduleTime(key: string, fallback: string): string {
  const stored = readStorage(key)
  return isTimeOfDay(stored) ? stored : fallback
}

export const scheduleLightTimeChanged = createEvent<string>()
export const $scheduleLightTime = createStore<string>(
  readScheduleTime(SCHEDULE_LIGHT_TIME_KEY, DEFAULT_SCHEDULE_LIGHT_TIME),
)
  .on(scheduleLightTimeChanged, (_, time) => time)
  .on(defaultsRestored, () => DEFAULT_SCHEDULE_LIGHT_TIME)

export const scheduleDarkTimeChanged = createEvent<string>()
export const $scheduleDarkTime = createStore<string>(
  readScheduleTime(SCHEDULE_DARK_TIME_KEY, DEFAULT_SCHEDULE_DARK_TIME),
)
  .on(scheduleDarkTimeChanged, (_, time) => time)
  .on(defaultsRestored, () => DEFAULT_SCHEDULE_DARK_TIME)

const persistScheduleLightTimeFx = createEffect((time: string) => {
  writeStorage(SCHEDULE_LIGHT_TIME_KEY, time)
})
const persistScheduleDarkTimeFx = createEffect((time: string) => {
  writeStorage(SCHEDULE_DARK_TIME_KEY, time)
})
sample({ clock: $scheduleLightTime, target: persistScheduleLightTimeFx })
sample({ clock: $scheduleDarkTime, target: persistScheduleDarkTimeFx })

// --- Schedule mode: live boundary crossing ----------------------------------
//
// Keeps `$scheduledResolvedTheme` correct not just at load but at the exact
// moment a light/dark switch time passes WHILE THE APP STAYS OPEN — a plain
// `combine` recomputed only when its own Effector stores change has no way
// to react to the wall clock moving on its own, so this drives it with an
// explicit `setTimeout` armed for exactly the next boundary
// (`nextScheduleBoundary`, `lib/themeSchedule.ts`), not a polling interval —
// the switch happens right when it should, not up to a poll period late.
// Same "module-level, registered once, lives for the page's lifetime" shape
// as `prefersDarkQuery` above, for the same reason: the schedule must keep
// advancing even while no component that cares (`ui/SettingsModal.vue`) is
// mounted.
const scheduleRecomputed = createEvent<ResolvedTheme>()

const $scheduledResolvedTheme = createStore<ResolvedTheme>(
  resolveScheduledTheme(new Date(), $scheduleLightTime.getState(), $scheduleDarkTime.getState()),
).on(scheduleRecomputed, (_, theme) => theme)

let scheduleTimeoutId: ReturnType<typeof setTimeout> | null = null

/** Recomputes `$scheduledResolvedTheme` against the current time and BOTH
 * schedule settings' live state (read via `.getState()`, never a closed-
 * over/watched payload — see the call sites below for why that matters),
 * then arms exactly one fresh timer for the next boundary. Clearing the
 * previous timer first means changing either time setting mid-countdown
 * cancels the stale boundary instead of firing it alongside the new one. */
function armScheduleTimer(): void {
  if (scheduleTimeoutId !== null) {
    clearTimeout(scheduleTimeoutId)
    scheduleTimeoutId = null
  }
  const lightTime = $scheduleLightTime.getState()
  const darkTime = $scheduleDarkTime.getState()
  const now = new Date()
  scheduleRecomputed(resolveScheduledTheme(now, lightTime, darkTime))
  const boundary = nextScheduleBoundary(now, lightTime, darkTime)
  const delayMs = Math.max(0, boundary.getTime() - now.getTime())
  scheduleTimeoutId = setTimeout(armScheduleTimer, delayMs)
}

// Arms the timer once at module load, then re-arms it every time either
// time setting changes. `.watch` fires immediately with the current value
// too — harmless here (unlike a naive "apply the watched payload" handler
// would be) because `armScheduleTimer` always re-reads BOTH stores' live
// state itself rather than trusting whichever one's change triggered it,
// so it's correct no matter which of these two subscriptions happens to
// fire first. Guarded the same way `prefersDarkQuery` above is: this
// module can be imported outside a browser (unit tests importing sibling
// exports), where there is no page lifetime for a timer to usefully run
// for.
if (typeof window !== 'undefined') {
  $scheduleLightTime.watch(armScheduleTimer)
  $scheduleDarkTime.watch(armScheduleTimer)
}

/** Always 'light' or 'dark', never the literal strings 'system'/'schedule'
 * — this is what actually gets written to `<html data-theme>` below.
 * Recomputes (and, via the `sample` further down, re-applies to the DOM)
 * the instant `$theme`, `$prefersDark`, or `$scheduledResolvedTheme`
 * changes, so a live OS-preference flip while `$theme === 'system'`, or a
 * live schedule-boundary crossing while `$theme === 'schedule'`, repaints
 * immediately with no reload needed. */
const $resolvedTheme = combine(
  $theme,
  $prefersDark,
  $scheduledResolvedTheme,
  (theme, prefersDark, scheduled): ResolvedTheme => {
    if (theme === THEMES.system) return prefersDark ? THEMES.dark : THEMES.light
    if (theme === THEMES.schedule) return scheduled
    return theme
  },
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

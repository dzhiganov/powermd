import { createEffect, createEvent, createStore, sample } from 'effector'

import { readStorage, writeStorage } from '@/shared/lib/storage'

export type ViewMode = 'editor' | 'split' | 'preview'

const RATIO_STORAGE_KEY = 'markdown-editor:split-ratio'
const VIEW_MODE_STORAGE_KEY = 'markdown-editor:view-mode'

/**
 * Neither pane may collapse below 15% of the split container's width.
 * Expressed as a ratio rather than a fixed pixel count so the minimum
 * scales with the window: 15% is ~154px on a 1024px laptop (still enough
 * for a code line or a heading) and ~384px on a 2560px ultra-wide
 * monitor, where a fixed 200px would look arbitrarily cramped.
 */
export const MIN_RATIO = 0.15
export const MAX_RATIO = 1 - MIN_RATIO
export const DEFAULT_RATIO = 0.5

/** Keyboard nudge steps for the splitter, in the same 0-1 ratio units as
 * `$splitRatio`. */
export const KEYBOARD_STEP = 0.02
export const KEYBOARD_STEP_LARGE = 0.1

/**
 * Clamps to `[MIN_RATIO, MAX_RATIO]`, and falls back to `DEFAULT_RATIO`
 * for anything that isn't a finite number (NaN from a corrupt/garbage
 * localStorage value, `Infinity`, etc.) — the one place this is enforced,
 * so neither a bad stored value nor a stray drag past the container edge
 * can ever collapse a pane.
 */
export function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_RATIO
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, value))
}

function readInitialRatio(): number {
  const stored = readStorage(RATIO_STORAGE_KEY)
  // `Number('')` is `0`, which would otherwise clamp to `MIN_RATIO` instead
  // of falling back to the default — guard empty/whitespace-only values
  // the same way a missing key is already handled.
  if (stored === null || stored.trim() === '') return DEFAULT_RATIO
  return clampRatio(Number(stored))
}

function isViewMode(value: string | null): value is ViewMode {
  return value === 'editor' || value === 'split' || value === 'preview'
}

function readInitialViewMode(): ViewMode {
  const stored = readStorage(VIEW_MODE_STORAGE_KEY)
  return isViewMode(stored) ? stored : 'split'
}

// --- Split ratio ------------------------------------------------------
//
// `splitRatioChanged` is deliberately not fired on every pointermove of a
// drag (see ui/Splitter.vue) — only on drag end, on a keyboard nudge, or
// on a reset. That's what keeps this store (and the localStorage write
// below) from firing per-pixel; the drag itself is driven by direct CSS
// custom property writes outside Vue/Effector entirely.

export const splitRatioChanged = createEvent<number>()
export const splitRatioReset = createEvent()

export const $splitRatio = createStore<number>(readInitialRatio())
  .on(splitRatioChanged, (_, value) => clampRatio(value))
  .on(splitRatioReset, () => DEFAULT_RATIO)

const persistRatioFx = createEffect((ratio: number) => {
  writeStorage(RATIO_STORAGE_KEY, String(ratio))
})

sample({ clock: $splitRatio, target: persistRatioFx })

// --- View mode ----------------------------------------------------------

export const viewModeChanged = createEvent<ViewMode>()

export const $viewMode = createStore<ViewMode>(readInitialViewMode()).on(
  viewModeChanged,
  (_, mode) => mode,
)

const persistViewModeFx = createEffect((mode: ViewMode) => {
  writeStorage(VIEW_MODE_STORAGE_KEY, mode)
})

sample({ clock: $viewMode, target: persistViewModeFx })

// --- Mobile tab (view-only, not persisted) -------------------------------
//
// Below the `md` breakpoint there's no split pane, so the toolbar's
// desktop `$viewMode` ('editor' | 'split' | 'preview') doesn't map 1:1 onto
// a two-way mobile tab. This store is what MobileTabs.vue actually drives:
// it starts out mirroring `$viewMode` (falling back to 'editor' for
// 'split', which has no tab of its own) but never writes back to it and is
// never persisted, so tapping a tab on a phone can no longer clobber the
// desktop `split` preference saved in localStorage.
export type MobileTab = 'editor' | 'preview'

export const mobileTabChanged = createEvent<MobileTab>()

function toMobileTab(mode: ViewMode): MobileTab {
  return mode === 'preview' ? 'preview' : 'editor'
}

export const $mobileTab = createStore<MobileTab>(toMobileTab($viewMode.getState())).on(
  mobileTabChanged,
  (_, tab) => tab,
)

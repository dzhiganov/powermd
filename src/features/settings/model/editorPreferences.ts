import { combine, createEffect, createEvent, createStore, sample } from 'effector'

import { readStorage, writeStorage } from '@/shared/lib/storage'

export type EditorFontFamily = 'mono' | 'serif'

const FONT_SIZE_KEY = 'markdown-editor:editor-font-size'
const FONT_FAMILY_KEY = 'markdown-editor:editor-font-family'
const LINE_WRAP_KEY = 'markdown-editor:line-wrap'
const AUTOSAVE_MS_KEY = 'markdown-editor:autosave-ms'
const READING_WIDTH_KEY = 'markdown-editor:reading-width'

export const FONT_SIZE_MIN = 12
export const FONT_SIZE_MAX = 20
const DEFAULT_FONT_SIZE = 14

export const AUTOSAVE_MS_MIN = 200
export const AUTOSAVE_MS_MAX = 3000
const DEFAULT_AUTOSAVE_MS = 500

export const READING_WIDTH_MIN = 50
export const READING_WIDTH_MAX = 100
const DEFAULT_READING_WIDTH = 75

/** Applied as `--md-editor-font-family` (see `applyEditorCssVarsFx` below,
 * and `features/editor/lib/theme.ts` which consumes it). `mono` matches the
 * stack the editor theme hardcoded before this preference existed; `serif`
 * is the "system/serif" alternative called for in the Step 8 spec. */
const FONT_FAMILY_STACKS: Record<EditorFontFamily, string> = {
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function readNumber(key: string, fallback: number, min: number, max: number): number {
  const stored = readStorage(key)
  if (stored === null || stored.trim() === '') return fallback
  return clamp(Number(stored), min, max)
}

function readBoolean(key: string, fallback: boolean): boolean {
  const stored = readStorage(key)
  if (stored === null) return fallback
  return stored === 'true'
}

function isFontFamily(value: string | null): value is EditorFontFamily {
  return value === 'mono' || value === 'serif'
}

function readFontFamily(): EditorFontFamily {
  const stored = readStorage(FONT_FAMILY_KEY)
  return isFontFamily(stored) ? stored : 'mono'
}

// One shared persistence effect, parameterised by key/value, rather than a
// separate `createEffect` per preference below — same storage helper
// (`writeStorage`), same fire-and-forget shape every time.
const persistFx = createEffect(({ key, value }: { key: string; value: string }) => {
  writeStorage(key, value)
})

// --- Font size ---------------------------------------------------------

export const editorFontSizeChanged = createEvent<number>()
export const $editorFontSize = createStore<number>(
  readNumber(FONT_SIZE_KEY, DEFAULT_FONT_SIZE, FONT_SIZE_MIN, FONT_SIZE_MAX),
).on(editorFontSizeChanged, (_, size) => clamp(size, FONT_SIZE_MIN, FONT_SIZE_MAX))

sample({
  clock: $editorFontSize,
  fn: (size) => ({ key: FONT_SIZE_KEY, value: String(size) }),
  target: persistFx,
})

// --- Font family ---------------------------------------------------------

export const editorFontFamilyChanged = createEvent<EditorFontFamily>()
export const $editorFontFamily = createStore<EditorFontFamily>(readFontFamily()).on(
  editorFontFamilyChanged,
  (_, family) => family,
)

sample({
  clock: $editorFontFamily,
  fn: (family) => ({ key: FONT_FAMILY_KEY, value: family }),
  target: persistFx,
})

// --- Line wrap ---------------------------------------------------------

export const lineWrapToggled = createEvent()
export const $lineWrapEnabled = createStore<boolean>(readBoolean(LINE_WRAP_KEY, true)).on(
  lineWrapToggled,
  (enabled) => !enabled,
)

sample({
  clock: $lineWrapEnabled,
  fn: (enabled) => ({ key: LINE_WRAP_KEY, value: String(enabled) }),
  target: persistFx,
})

// --- Autosave debounce ---------------------------------------------------------

export const autosaveDebounceChanged = createEvent<number>()
export const $autosaveDebounceMs = createStore<number>(
  readNumber(AUTOSAVE_MS_KEY, DEFAULT_AUTOSAVE_MS, AUTOSAVE_MS_MIN, AUTOSAVE_MS_MAX),
).on(autosaveDebounceChanged, (_, ms) => clamp(ms, AUTOSAVE_MS_MIN, AUTOSAVE_MS_MAX))

sample({
  clock: $autosaveDebounceMs,
  fn: (ms) => ({ key: AUTOSAVE_MS_KEY, value: String(ms) }),
  target: persistFx,
})

// --- Reading width ---------------------------------------------------------

export const readingWidthChanged = createEvent<number>()
export const $readingWidthCh = createStore<number>(
  readNumber(READING_WIDTH_KEY, DEFAULT_READING_WIDTH, READING_WIDTH_MIN, READING_WIDTH_MAX),
).on(readingWidthChanged, (_, width) => clamp(width, READING_WIDTH_MIN, READING_WIDTH_MAX))

sample({
  clock: $readingWidthCh,
  fn: (width) => ({ key: READING_WIDTH_KEY, value: String(width) }),
  target: persistFx,
})

// --- Apply font/width preferences as CSS custom properties ------------------
//
// Font size, font family, and reading width are consumed entirely as CSS:
// the CodeMirror theme's `.cm-scroller` (`features/editor/lib/theme.ts`)
// and the editor/preview panes' reading column both already read DaisyUI's
// own `--color-*` variables the same way, repainting themselves the moment
// `data-theme` changes with no JS involved on the consuming side. Applying
// these three preferences here is just three more custom properties on
// `<html>` — no Compartment reconfigure, no remount, needed anywhere
// downstream (unlike line wrap, which is a real CodeMirror extension and
// does need one — see `features/editor/lib/useCodeMirror.ts`).
const applyEditorCssVarsFx = createEffect(
  (vars: { fontSize: number; fontFamily: EditorFontFamily; readingWidth: number }) => {
    const root = document.documentElement
    root.style.setProperty('--md-editor-font-size', `${vars.fontSize}px`)
    root.style.setProperty('--md-editor-font-family', FONT_FAMILY_STACKS[vars.fontFamily])
    root.style.setProperty('--md-reading-width', `${vars.readingWidth}ch`)
  },
)

const $editorCssVars = combine(
  $editorFontSize,
  $editorFontFamily,
  $readingWidthCh,
  (fontSize, fontFamily, readingWidth) => ({ fontSize, fontFamily, readingWidth }),
)

sample({ clock: $editorCssVars, target: applyEditorCssVarsFx })
// One explicit kick applies the restored/default values immediately at
// startup — `sample`'s `clock` only reacts to *updates*, not the value a
// store already holds when this module evaluates (same reasoning as the
// `sourceReceived($content.getState())` kick in `src/app/wiring.ts`).
applyEditorCssVarsFx($editorCssVars.getState())

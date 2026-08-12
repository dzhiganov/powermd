import { combine, createEffect, createEvent, createStore, sample } from 'effector'

import { readStorage, writeStorage } from '@/shared/lib/storage'
import { defaultsRestored } from './resetDefaults'

export type EditorFontFamily = 'mono' | 'serif'

const FONT_SIZE_KEY = 'markdown-editor:editor-font-size'
const FONT_FAMILY_KEY = 'markdown-editor:editor-font-family'
const LINE_WRAP_KEY = 'markdown-editor:line-wrap'
const WORD_COMPLETION_ENABLED_KEY = 'markdown-editor:word-completion-enabled'
const AUTOSAVE_MS_KEY = 'markdown-editor:autosave-ms'
const READING_WIDTH_KEY = 'markdown-editor:reading-width'
const SPELLCHECK_ENABLED_KEY = 'markdown-editor:spellcheck-enabled'
const SPELLCHECK_LANGUAGE_KEY = 'markdown-editor:spellcheck-language'

export const FONT_SIZE_MIN = 12
export const FONT_SIZE_MAX = 20
// 14.5px matches the reference design's editor type scale
// (`design-template.html`'s `<textarea>` rule) — still just the *default*
// within the existing 12-20px user-adjustable range, not a new floor/ceiling.
const DEFAULT_FONT_SIZE = 14.5

const DEFAULT_LINE_WRAP = true

/**
 * Off by default — the one preference in this file that deliberately does
 * NOT default to "on, because it's helpful" the way line wrap/spell check
 * do. `@codemirror/autocomplete`'s default keymap binds Enter to
 * "accept the selected completion" (`completionKeymap`, unconditionally
 * active whenever a menu is open — see `features/editor/lib/useCodeMirror
 * .ts`'s `buildCompletionExtension`), which is exactly the key a prose
 * writer reaches for constantly to start a new line/paragraph. With word
 * completion on, a menu that happens to be open because the word just typed
 * matched something elsewhere in the document would silently swallow that
 * Enter and insert a completion instead of a newline — a real, recurring
 * interruption to normal writing flow, not a hypothetical edge case. Line
 * wrap and spell check carry no equivalent risk: neither one ever captures
 * a keystroke the user didn't intend for it. Opt-in here means a user who
 * wants the feature turns it on once in Settings -> Editor and never has to
 * think about it again; a user who doesn't want it is never surprised by
 * Enter doing the wrong thing.
 */
const DEFAULT_WORD_COMPLETION_ENABLED = false

export const AUTOSAVE_MS_MIN = 200
export const AUTOSAVE_MS_MAX = 3000
const DEFAULT_AUTOSAVE_MS = 500

export const READING_WIDTH_MIN = 50
export const READING_WIDTH_MAX = 100
const DEFAULT_READING_WIDTH = 75

/** Applied as `--md-editor-font-family` (see `applyEditorCssVarsFx` below,
 * and `features/editor/lib/theme.ts` which consumes it). `mono` leads with
 * the self-hosted IBM Plex Mono (`app/styles/main.css`'s `@fontsource`
 * imports, Phase 1 visual redesign) with the previous system-monospace
 * stack kept as the fallback chain; `serif` is the "system/serif"
 * alternative called for in the Step 8 spec, unchanged by that redesign. */
const FONT_FAMILY_STACKS: Record<EditorFontFamily, string> = {
  mono: '"IBM Plex Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
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

const DEFAULT_FONT_FAMILY: EditorFontFamily = 'mono'

function isFontFamily(value: string | null): value is EditorFontFamily {
  return value === 'mono' || value === 'serif'
}

function readFontFamily(): EditorFontFamily {
  const stored = readStorage(FONT_FAMILY_KEY)
  return isFontFamily(stored) ? stored : DEFAULT_FONT_FAMILY
}

/**
 * `'default'` means "don't set `lang` at all" — the editor's content
 * element then inherits `<html lang="en">` (see `index.html`), so the
 * browser resolves spelling against whatever the page's own language is.
 * Every other value is a real BCP-47 language subtag, applied directly as
 * the content element's `lang` attribute (see `useCodeMirror.ts`'s
 * `buildContentAttributes`) — the browser (not this app) is what actually
 * owns which dictionaries exist for it; this list only offers a reasonable
 * spread of ones a browser/OS commonly ships.
 */
export type SpellCheckLanguage = 'default' | 'en' | 'de' | 'fr' | 'es' | 'ru' | 'pt' | 'it' | 'nl'

export const SPELLCHECK_LANGUAGES: ReadonlyArray<{ value: SpellCheckLanguage; label: string }> = [
  { value: 'default', label: 'Follow the page default' },
  { value: 'en', label: 'English' },
  { value: 'de', label: 'German' },
  { value: 'fr', label: 'French' },
  { value: 'es', label: 'Spanish' },
  { value: 'ru', label: 'Russian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'it', label: 'Italian' },
  { value: 'nl', label: 'Dutch' },
]

const DEFAULT_SPELLCHECK_ENABLED = true
const DEFAULT_SPELLCHECK_LANGUAGE: SpellCheckLanguage = 'default'

function isSpellCheckLanguage(value: string | null): value is SpellCheckLanguage {
  return SPELLCHECK_LANGUAGES.some((entry) => entry.value === value)
}

function readSpellCheckLanguage(): SpellCheckLanguage {
  const stored = readStorage(SPELLCHECK_LANGUAGE_KEY)
  return isSpellCheckLanguage(stored) ? stored : DEFAULT_SPELLCHECK_LANGUAGE
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
)
  .on(editorFontSizeChanged, (_, size) => clamp(size, FONT_SIZE_MIN, FONT_SIZE_MAX))
  .on(defaultsRestored, () => DEFAULT_FONT_SIZE)

sample({
  clock: $editorFontSize,
  fn: (size) => ({ key: FONT_SIZE_KEY, value: String(size) }),
  target: persistFx,
})

// --- Font family ---------------------------------------------------------

export const editorFontFamilyChanged = createEvent<EditorFontFamily>()
export const $editorFontFamily = createStore<EditorFontFamily>(readFontFamily())
  .on(editorFontFamilyChanged, (_, family) => family)
  .on(defaultsRestored, () => DEFAULT_FONT_FAMILY)

sample({
  clock: $editorFontFamily,
  fn: (family) => ({ key: FONT_FAMILY_KEY, value: family }),
  target: persistFx,
})

// --- Line wrap ---------------------------------------------------------

export const lineWrapToggled = createEvent()
export const $lineWrapEnabled = createStore<boolean>(readBoolean(LINE_WRAP_KEY, DEFAULT_LINE_WRAP))
  .on(lineWrapToggled, (enabled) => !enabled)
  .on(defaultsRestored, () => DEFAULT_LINE_WRAP)

sample({
  clock: $lineWrapEnabled,
  fn: (enabled) => ({ key: LINE_WRAP_KEY, value: String(enabled) }),
  target: persistFx,
})

// --- Word completion -------------------------------------------------------
//
// In-document word completion (`features/editor/lib/wordCompletion.ts`):
// suggests words that already appear elsewhere in the current document as
// the user types. See `DEFAULT_WORD_COMPLETION_ENABLED` above for why this
// one preference defaults to off rather than on.

export const wordCompletionToggled = createEvent()
export const $wordCompletionEnabled = createStore<boolean>(
  readBoolean(WORD_COMPLETION_ENABLED_KEY, DEFAULT_WORD_COMPLETION_ENABLED),
)
  .on(wordCompletionToggled, (enabled) => !enabled)
  .on(defaultsRestored, () => DEFAULT_WORD_COMPLETION_ENABLED)

sample({
  clock: $wordCompletionEnabled,
  fn: (enabled) => ({ key: WORD_COMPLETION_ENABLED_KEY, value: String(enabled) }),
  target: persistFx,
})

// --- Spell check ---------------------------------------------------------
//
// Two independent preferences — on/off, and which language's dictionary
// the browser should check against — both applied to the editor's content
// element live, via `features/editor/lib/useCodeMirror.ts`'s own
// Compartment (same "reconfigure in place, never a state rebuild" shape as
// `$lineWrapEnabled` above), never a reload.

export const spellCheckToggled = createEvent()
export const $spellCheckEnabled = createStore<boolean>(
  readBoolean(SPELLCHECK_ENABLED_KEY, DEFAULT_SPELLCHECK_ENABLED),
)
  .on(spellCheckToggled, (enabled) => !enabled)
  .on(defaultsRestored, () => DEFAULT_SPELLCHECK_ENABLED)

sample({
  clock: $spellCheckEnabled,
  fn: (enabled) => ({ key: SPELLCHECK_ENABLED_KEY, value: String(enabled) }),
  target: persistFx,
})

export const spellCheckLanguageChanged = createEvent<SpellCheckLanguage>()
export const $spellCheckLanguage = createStore<SpellCheckLanguage>(readSpellCheckLanguage())
  .on(spellCheckLanguageChanged, (_, language) => language)
  .on(defaultsRestored, () => DEFAULT_SPELLCHECK_LANGUAGE)

sample({
  clock: $spellCheckLanguage,
  fn: (language) => ({ key: SPELLCHECK_LANGUAGE_KEY, value: language }),
  target: persistFx,
})

// --- Autosave debounce ---------------------------------------------------------

export const autosaveDebounceChanged = createEvent<number>()
export const $autosaveDebounceMs = createStore<number>(
  readNumber(AUTOSAVE_MS_KEY, DEFAULT_AUTOSAVE_MS, AUTOSAVE_MS_MIN, AUTOSAVE_MS_MAX),
)
  .on(autosaveDebounceChanged, (_, ms) => clamp(ms, AUTOSAVE_MS_MIN, AUTOSAVE_MS_MAX))
  .on(defaultsRestored, () => DEFAULT_AUTOSAVE_MS)

sample({
  clock: $autosaveDebounceMs,
  fn: (ms) => ({ key: AUTOSAVE_MS_KEY, value: String(ms) }),
  target: persistFx,
})

// --- Reading width ---------------------------------------------------------

export const readingWidthChanged = createEvent<number>()
export const $readingWidthCh = createStore<number>(
  readNumber(READING_WIDTH_KEY, DEFAULT_READING_WIDTH, READING_WIDTH_MIN, READING_WIDTH_MAX),
)
  .on(readingWidthChanged, (_, width) => clamp(width, READING_WIDTH_MIN, READING_WIDTH_MAX))
  .on(defaultsRestored, () => DEFAULT_READING_WIDTH)

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

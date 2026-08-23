import { combine, createEffect, createEvent, createStore, sample } from 'effector'

import { readStorage, writeStorage } from '@/shared/lib/storage'
import { focusDimColor } from '@/shared/lib/focusDimColor'
import { defaultsRestored } from './resetDefaults'

export type EditorFontFamily = 'mono' | 'serif'

const FONT_SIZE_KEY = 'markdown-editor:editor-font-size'
const FONT_FAMILY_KEY = 'markdown-editor:editor-font-family'
const LINE_WRAP_KEY = 'markdown-editor:line-wrap'
const WORD_COMPLETION_ENABLED_KEY = 'markdown-editor:word-completion-enabled'
const WORD_COMPLETION_EXCLUDED_FOLDERS_KEY = 'markdown-editor:word-completion-excluded-folders'
const FOCUS_MODE_ENABLED_KEY = 'markdown-editor:focus-mode-enabled'
const FOCUS_DIM_LEVEL_KEY = 'markdown-editor:focus-dim-level'
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

/**
 * Off by default, same rationale as `DEFAULT_WORD_COMPLETION_ENABLED` just
 * above but for a different reason: focus mode changes how the whole editor
 * *looks* the instant it's on (see `features/editor/lib/focusMode.ts`), not
 * just how one keystroke behaves — that kind of visual change should be
 * something a user opts into deliberately, not something that's already on
 * the first time they open the app.
 */
const DEFAULT_FOCUS_MODE_ENABLED = false

/**
 * Range for the "Focus dim level" slider next to the Focus mode toggle
 * (`ui/SettingsModal.vue`) — the user-adjustable replacement for what used
 * to be a single fixed 65% constant baked into `features/editor/lib/
 * focusMode.ts`. The slider's VALUE is the same number that constant used to
 * be: the percentage of `--color-base-content` kept in the dimmed line's
 * `color-mix()` (see `shared/lib/focusDimColor.ts`), so a higher number
 * means LESS dimming (closer to full-strength text) and a lower number means
 * MORE dimming.
 *
 * FOCUS_DIM_LEVEL_MIN — the floor a user is allowed to drag down to, derived
 * (not picked as a round number) from the same 4.5:1 WCAG AA text-contrast
 * requirement `focusMode.ts` always documented, computed against all FOUR
 * theme x soft-contrast combinations (their exact `--color-base-content`/
 * `--color-base-100` hex pairs live in `app/styles/main.css`):
 *
 *   light        #1c1b19 on #fbfaf8
 *   light+soft   #1c1b19 on #e9e7e2
 *   dark         #e8e6e3 on #0e0f11
 *   dark+soft    #e8e6e3 on #1b1c1e
 *
 * `color-mix(in srgb, ...)` is a plain per-channel linear blend (see
 * `focusDimColor.ts`'s own comment), so the mixed channel at level L is
 * `L/100 * content + (1 - L/100) * base100` per channel, and the WCAG
 * relative-luminance contrast of that mix against `base100` is a monotonic,
 * continuous function of L — solvable exactly (binary search to 1e-4,
 * script + the standard WCAG relative-luminance formula) for the L at which
 * each combination's ratio hits exactly 4.500:1:
 *
 *   light        L = 60.2557
 *   light+soft   L = 62.2242   <- tightest (matches focusMode.ts's own
 *                                  original "~62.2%" estimate for its old
 *                                  fixed 65% constant, before this became
 *                                  user-adjustable)
 *   dark         L = 49.9750
 *   dark+soft    L = 50.9684
 *
 * light+soft is the binding constraint (as it was for the original 65%
 * constant), so the slider's floor has to clear 62.2242 in every theme.
 * Rounding to a whole-number slider step (matching every other integer-only
 * range in this file — `AUTOSAVE_MS_MIN`/`READING_WIDTH_MIN` etc. below are
 * all whole numbers too), the two candidate integers straddling that exact
 * value were both re-measured with the mixed channels rounded to the nearest
 * 8-bit integer FIRST (simulating the browser's own pixel quantization,
 * rather than trusting the unrounded floating-point ratio):
 *
 *   L=62  light+soft -> 4.4469:1  (BELOW the 4.5:1 floor — fails)
 *   L=63  light+soft -> 4.6312:1  (clears, with real margin)
 *
 * 63 is therefore the lowest whole-number level that clears 4.5:1 in every
 * one of the four combinations even after 8-bit rounding — the actual
 * `FOCUS_DIM_LEVEL_MIN` below. Re-verified against ACTUAL rendered pixels in
 * a real Chromium tab, not just this formula — `e2e/focus-dim-contrast.spec
 * .ts` sets focus mode on, dim level to 63, and each theme/soft combination
 * in turn (via `localStorage` + a full reload), then reads
 * `getComputedStyle(...).color` off a real dimmed `.cm-line` and the
 * editor's own rendered background and computes the ratio from those actual
 * pixels. Measured that way:
 *
 *   light        4.9182:1
 *   light+soft   4.6079:1  <- still the tightest, still clears 4.5:1
 *   dark         6.5287:1
 *   dark+soft    6.1633:1
 *
 * (Close to, but not bit-identical with, the hand-simulated 8-bit-rounded
 * figures above — Chromium's own `color-mix()` implementation doesn't
 * necessarily round at exactly the same intermediate step this comment's
 * by-hand simulation does. Both agree on the conclusion that matters: every
 * combination clears 4.5:1 at level 63, light+soft by the smallest margin.)
 *
 * FOCUS_DIM_LEVEL_MAX = 100 — full-strength `--color-base-content`, i.e.
 * effectively no dimming at all ("barely dimmed" was the requirement for the
 * top of the range; 100 is the literal zero-dimming limit color-mix can
 * express, so nothing rounder or higher is possible).
 *
 * DEFAULT_FOCUS_DIM_LEVEL stays 65 — the exact value the old fixed constant
 * used — so a user who never touches this new slider keeps seeing exactly
 * the same dim they always did; only the ability to move it is new.
 */
export const FOCUS_DIM_LEVEL_MIN = 63
export const FOCUS_DIM_LEVEL_MAX = 100
const DEFAULT_FOCUS_DIM_LEVEL = 65

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

/** Reads a persisted JSON array of strings — same defensive shape as
 * `features/documents/model/documents.ts`'s `readInitialCollapsedFolderIds`
 * (missing key or malformed JSON both fall back to `[]`, never a thrown
 * error), used here for the word-completion folder-exclusion list below. */
function readStringArray(key: string): string[] {
  const stored = readStorage(key)
  if (stored === null) return []
  try {
    const parsed: unknown = JSON.parse(stored)
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : []
  } catch {
    return []
  }
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

// --- Word completion: per-folder exclusion --------------------------------
//
// Folder ids whose documents get no word-completion suggestions even while
// the global toggle above is on — e.g. a folder of notes in a language the
// user is learning, whose vocabulary they don't want leaking into every
// other document's suggestions. Scoped to word completion only: wiki-link
// completion is explicitly invoked (`[[`) and stays on everywhere,
// regardless of this list — see `src/app/lib/wordCompletionScope.ts`, the
// pure function that combines this list with the global toggle and the
// open document's folder into the one boolean actually pushed into the
// editor feature.
//
// Stores opaque folder ids only, exactly like `features/documents/model/
// documents.ts`'s `$collapsedFolderIds` — this feature never imports
// `documents` (see `ui/DocumentDrawer.vue`'s own note on that boundary), so
// it has no notion of a `Folder` beyond the id string the settings UI's
// checkboxes toggle. A folder deleted while its id is still in this list
// is harmless and requires no special handling here: deleting a folder
// moves every document that was inside it to root (`folderId: null`,
// see `documents.ts`'s `deleteFolderFx`), so no document can ever match a
// stale id again, and the settings UI (fed by `$documentFolders` below,
// itself sourced from the live folder list) simply stops rendering a
// checkbox for it — never a "ghost" entry the user can still see or
// toggle. The stale id itself just sits unused in storage, the same way
// `$collapsedFolderIds` would if it didn't bother pruning either.
export const wordCompletionFolderExclusionToggled = createEvent<string>()
export const $wordCompletionExcludedFolderIds = createStore<string[]>(
  readStringArray(WORD_COMPLETION_EXCLUDED_FOLDERS_KEY),
)
  .on(wordCompletionFolderExclusionToggled, (ids, folderId) =>
    ids.includes(folderId) ? ids.filter((id) => id !== folderId) : [...ids, folderId],
  )
  .on(defaultsRestored, () => [])

sample({
  clock: $wordCompletionExcludedFolderIds,
  fn: (ids) => ({ key: WORD_COMPLETION_EXCLUDED_FOLDERS_KEY, value: JSON.stringify(ids) }),
  target: persistFx,
})

// --- Focus mode ------------------------------------------------------------
//
// Dims every line in the editor except the paragraph the cursor is in
// (`features/editor/lib/focusMode.ts`). Editor-only — never touches the
// preview — and a straight on/off toggle with no per-folder exception,
// unlike word completion above.

export const focusModeToggled = createEvent()
export const $focusModeEnabled = createStore<boolean>(
  readBoolean(FOCUS_MODE_ENABLED_KEY, DEFAULT_FOCUS_MODE_ENABLED),
)
  .on(focusModeToggled, (enabled) => !enabled)
  .on(defaultsRestored, () => DEFAULT_FOCUS_MODE_ENABLED)

sample({
  clock: $focusModeEnabled,
  fn: (enabled) => ({ key: FOCUS_MODE_ENABLED_KEY, value: String(enabled) }),
  target: persistFx,
})

// --- Focus mode dim level ---------------------------------------------------
//
// How strongly focus mode dims non-active lines — see `FOCUS_DIM_LEVEL_MIN`'s
// own doc comment above for the full derivation of the range, and
// `shared/lib/focusDimColor.ts` for what the number actually becomes on
// screen. Independent of `$focusModeEnabled` above (this level is stored and
// persisted regardless of whether focus mode is currently on — turning focus
// mode on later picks up whatever level was last set, the same way changing
// the level while focus mode is off just has no visible effect yet, exactly
// like word completion's per-folder exclusion list while word completion
// itself is off — see `ui/SettingsModal.vue`'s own note on that).
export const focusDimLevelChanged = createEvent<number>()
export const $focusDimLevel = createStore<number>(
  readNumber(
    FOCUS_DIM_LEVEL_KEY,
    DEFAULT_FOCUS_DIM_LEVEL,
    FOCUS_DIM_LEVEL_MIN,
    FOCUS_DIM_LEVEL_MAX,
  ),
)
  .on(focusDimLevelChanged, (_, level) => clamp(level, FOCUS_DIM_LEVEL_MIN, FOCUS_DIM_LEVEL_MAX))
  .on(defaultsRestored, () => DEFAULT_FOCUS_DIM_LEVEL)

sample({
  clock: $focusDimLevel,
  fn: (level) => ({ key: FOCUS_DIM_LEVEL_KEY, value: String(level) }),
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

// --- Apply font/width/focus-dim preferences as CSS custom properties -------
//
// Font size, font family, reading width, and the focus-dim level are all
// consumed entirely as CSS: the CodeMirror theme's `.cm-scroller`
// (`features/editor/lib/theme.ts`) and the editor/preview panes' reading
// column both already read DaisyUI's own `--color-*` variables the same way,
// repainting themselves the moment `data-theme` changes with no JS involved
// on the consuming side; `focusMode.ts`'s `.cm-focus-dim` rule now reads
// `--md-focus-dim-color` the same way. Applying these here is just four
// custom properties on `<html>` — no Compartment reconfigure, no remount,
// needed anywhere downstream (unlike line wrap or focus mode's own on/off
// toggle, which are real CodeMirror extensions and do need one — see
// `features/editor/lib/useCodeMirror.ts`). This is what lets the dim LEVEL
// change live, from Settings, without touching the CodeMirror instance at
// all: only the colour a CSS rule already references changes, the same as
// a theme swap.
const applyEditorCssVarsFx = createEffect(
  (vars: {
    fontSize: number
    fontFamily: EditorFontFamily
    readingWidth: number
    focusDimLevel: number
  }) => {
    const root = document.documentElement
    root.style.setProperty('--md-editor-font-size', `${vars.fontSize}px`)
    root.style.setProperty('--md-editor-font-family', FONT_FAMILY_STACKS[vars.fontFamily])
    root.style.setProperty('--md-reading-width', `${vars.readingWidth}ch`)
    root.style.setProperty('--md-focus-dim-color', focusDimColor(vars.focusDimLevel))
  },
)

const $editorCssVars = combine(
  $editorFontSize,
  $editorFontFamily,
  $readingWidthCh,
  $focusDimLevel,
  (fontSize, fontFamily, readingWidth, focusDimLevel) => ({
    fontSize,
    fontFamily,
    readingWidth,
    focusDimLevel,
  }),
)

sample({ clock: $editorCssVars, target: applyEditorCssVarsFx })
// One explicit kick applies the restored/default values immediately at
// startup — `sample`'s `clock` only reacts to *updates*, not the value a
// store already holds when this module evaluates (same reasoning as the
// `sourceReceived($content.getState())` kick in `src/app/wiring.ts`).
applyEditorCssVarsFx($editorCssVars.getState())

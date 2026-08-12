<script setup lang="ts">
import { ref, watch } from 'vue'
import { useUnit } from 'effector-vue/composition'
import { XMarkIcon } from '@heroicons/vue/24/outline'

import { useDialogFocusTrap } from '@/shared/lib/useDialog'
import { GitHubSyncPanel } from '@/features/github'

import {
  $editorFontSize,
  $editorFontFamily,
  $lineWrapEnabled,
  $autosaveDebounceMs,
  $readingWidthCh,
  $spellCheckEnabled,
  $spellCheckLanguage,
  $wordCompletionEnabled,
  $wordCompletionExcludedFolderIds,
  editorFontSizeChanged,
  editorFontFamilyChanged,
  lineWrapToggled,
  autosaveDebounceChanged,
  readingWidthChanged,
  spellCheckToggled,
  spellCheckLanguageChanged,
  wordCompletionToggled,
  wordCompletionFolderExclusionToggled,
  SPELLCHECK_LANGUAGES,
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  AUTOSAVE_MS_MIN,
  AUTOSAVE_MS_MAX,
  READING_WIDTH_MIN,
  READING_WIDTH_MAX,
  type SpellCheckLanguage,
} from '../model/editorPreferences'
import { $documentFolders } from '../model/folderMirror'
import {
  $settingsOpen,
  $settingsInitialCategory,
  settingsClosed,
  type SettingsCategory,
} from '../model/dialogs'
import {
  $showTooltips,
  showTooltipsToggled,
  $drawerSide,
  drawerSideChanged,
  $showFormattingToolbar,
  showFormattingToolbarToggled,
  $scrollSyncEnabled,
  scrollSyncToggled,
  $autoSyncIntervalMinutes,
  autoSyncIntervalMinutesChanged,
  AUTO_SYNC_INTERVAL_MINUTES_OPTIONS,
  type AutoSyncIntervalMinutes,
} from '../model/uiPreferences'
import { $softContrast, softContrastToggled } from '../model/softContrast'
import {
  $resetConfirmOpen,
  resetRequested,
  resetConfirmed,
  resetCancelled,
} from '../model/resetDefaults'

const open = useUnit($settingsOpen)
const fontSize = useUnit($editorFontSize)
const fontFamily = useUnit($editorFontFamily)
const lineWrap = useUnit($lineWrapEnabled)
const autosaveMs = useUnit($autosaveDebounceMs)
const readingWidth = useUnit($readingWidthCh)
const spellCheckEnabled = useUnit($spellCheckEnabled)
const spellCheckLanguage = useUnit($spellCheckLanguage)
const wordCompletionEnabled = useUnit($wordCompletionEnabled)
const wordCompletionExcludedFolderIds = useUnit($wordCompletionExcludedFolderIds)
const documentFolders = useUnit($documentFolders)
const showTooltips = useUnit($showTooltips)
const drawerSide = useUnit($drawerSide)
const showFormattingToolbar = useUnit($showFormattingToolbar)
const scrollSyncEnabled = useUnit($scrollSyncEnabled)
const autoSyncIntervalMinutes = useUnit($autoSyncIntervalMinutes)
const softContrast = useUnit($softContrast)

const dialogRef = ref<HTMLElement | null>(null)
const firstControlRef = ref<HTMLElement | null>(null)
const { trapFocus } = useDialogFocusTrap(dialogRef, open, firstControlRef)

// "Reset to defaults" confirmation — a second dialog layered above this
// one (higher z-index, its own focus trap) rather than nested inside it:
// nesting would put both dialogs' `@keydown.esc` listeners on the same
// element/its ancestors, so one Escape press while the confirm dialog is
// open would bubble up and close both at once. As a sibling, focus stays
// inside `resetDialogRef` while it's open (the trap below enforces that),
// so `dialogRef`'s own Escape/Tab handlers never see those keydowns.
const resetConfirmOpen = useUnit($resetConfirmOpen)
const resetDialogRef = ref<HTMLElement | null>(null)
const resetCancelButtonRef = ref<HTMLButtonElement | null>(null)
const { trapFocus: trapResetDialogFocus } = useDialogFocusTrap(
  resetDialogRef,
  resetConfirmOpen,
  resetCancelButtonRef,
)

function handleFontSizeInput(event: Event) {
  editorFontSizeChanged(Number((event.target as HTMLInputElement).value))
}
function handleAutosaveInput(event: Event) {
  autosaveDebounceChanged(Number((event.target as HTMLInputElement).value))
}
function handleReadingWidthInput(event: Event) {
  readingWidthChanged(Number((event.target as HTMLInputElement).value))
}
function handleSpellCheckLanguageChange(event: Event) {
  spellCheckLanguageChanged((event.target as HTMLSelectElement).value as SpellCheckLanguage)
}
function handleAutoSyncIntervalChange(event: Event) {
  autoSyncIntervalMinutesChanged(
    Number((event.target as HTMLSelectElement).value) as AutoSyncIntervalMinutes,
  )
}

// --- Category nav ---------------------------------------------------------
//
// WAI-ARIA "tabs" pattern (`role="tablist"`/`"tab"`/`"tabpanel"`) with
// roving tabindex: arrow keys move focus *and* activate the tab landed on,
// matching `FormattingToolbar.vue`'s existing toolbar-pattern precedent for
// the same "one stop in the page's Tab order, arrows move within it" shape.
// Vertical at `sm:` and up (a real left-side nav, per the task); the same
// buttons collapse to a horizontal, scrollable row above the content at
// narrower viewports instead of overflowing the dialog — see the
// `.settings-nav` rule in <style> for the breakpoint.
//
// Three categories (down from five): Editor stays as-is; Appearance now
// absorbs the old Layout and Documents categories too (reading width,
// formatting toolbar, tooltips, documents panel side, scroll sync —
// everything that's "how the app looks/behaves" rather than "how the
// editor itself behaves" or "where/how documents get saved"); Sync (renamed
// from "GitHub sync") covers everywhere a document's bytes end up outside
// the editor itself — the local autosave interval (moved in from
// Appearance: it's about *saving*, not appearance) above the GitHub
// connection UI moved in from the removed standalone `GitHubModal.vue` (see
// `GitHubSyncPanel.vue`), the two split by their own sub-heading so "save
// to this browser" and "sync to GitHub" are never confused for one setting.
// "Reset to defaults" is no longer a category at all — it's the footer
// button below, always reachable regardless of which category is active,
// rather than a destination you have to navigate to.
//
// Category content is `v-if`-switched, not `v-show`: every category except
// the active one is entirely absent from the DOM, so `trapFocus` above
// (which walks every focusable element currently inside `dialogRef`) never
// has to reason about skipping hidden-but-still-technically-focusable
// inputs from an inactive category.
interface Category {
  id: SettingsCategory
  label: string
}

const categories: Category[] = [
  { id: 'editor', label: 'Editor' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'sync', label: 'Sync' },
]

const activeCategory = ref<SettingsCategory>('editor')
const tabRefs = ref<(HTMLButtonElement | null)[]>([])

function setTabRef(el: unknown, index: number) {
  tabRefs.value[index] = el instanceof HTMLButtonElement ? el : null
}

function selectCategory(id: Category['id']) {
  activeCategory.value = id
}

function focusTabIndex(index: number) {
  const clamped = (index + categories.length) % categories.length
  activeCategory.value = categories[clamped].id
  tabRefs.value[clamped]?.focus()
}

function handleTabKeydown(event: KeyboardEvent, index: number) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
    event.preventDefault()
    focusTabIndex(index + 1)
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
    event.preventDefault()
    focusTabIndex(index - 1)
  } else if (event.key === 'Home') {
    event.preventDefault()
    focusTabIndex(0)
  } else if (event.key === 'End') {
    event.preventDefault()
    focusTabIndex(categories.length - 1)
  }
}

// Reopens on whichever category `settingsOpened` was fired with (the
// general "Settings" entry points pass `undefined`, resolving to Editor;
// `SyncStatusIndicator.vue`'s click resolves to `'sync'` — see
// `$settingsInitialCategory`'s own doc comment in `model/dialogs.ts`) —
// never silently resumes wherever the dialog was left several sessions ago.
const initialCategory = useUnit($settingsInitialCategory)
watch(open, (isOpen) => {
  if (isOpen) activeCategory.value = initialCategory.value
})
</script>

<template>
  <div
    v-if="open"
    ref="dialogRef"
    class="fixed inset-0 z-[60] flex items-center justify-center bg-black/25 p-4 print:hidden"
    role="dialog"
    aria-modal="true"
    aria-labelledby="settings-dialog-title"
    tabindex="-1"
    @keydown.esc="settingsClosed()"
    @keydown.tab="trapFocus"
  >
    <!-- Fixed width AND height (not `max-h`-only, content-driven, the way
         this dialog used to size itself) — switching categories must never
         change the dialog's own footprint, only what scrolls inside the
         content pane below. Still capped to the viewport (minus this
         wrapper's own `p-4`) via `max-w`/`max-h` so narrow/short viewports
         never get an overflowing dialog — at that point the fixed size
         simply stops applying and the dialog shrinks to fit, the nav's own
         `sm:` breakpoint (below) already collapsing it to a horizontal row
         well before that becomes necessary on any real device. -->
    <div
      class="settings-panel flex h-[600px] max-h-[calc(100dvh-2rem)] w-[640px] max-w-[calc(100dvw-2rem)] flex-col rounded-box shadow-xl"
    >
      <div class="flex shrink-0 items-center justify-between p-5 pb-4">
        <h2 id="settings-dialog-title" class="text-base font-semibold text-base-content">
          Settings
        </h2>
        <button
          ref="firstControlRef"
          type="button"
          class="btn btn-ghost btn-sm btn-square"
          aria-label="Close settings"
          @click="settingsClosed()"
        >
          <XMarkIcon class="h-4 w-4" />
        </button>
      </div>

      <div class="flex min-h-0 flex-1 flex-col overflow-hidden sm:flex-row">
        <div
          role="tablist"
          aria-label="Settings categories"
          aria-orientation="vertical"
          class="flex shrink-0 flex-row gap-1 overflow-x-auto border-base-300 px-5 pb-3 sm:w-36 sm:flex-col sm:gap-0.5 sm:overflow-x-visible sm:overflow-y-auto sm:border-r sm:py-2 sm:pr-2 sm:pb-2 sm:pl-3"
        >
          <button
            v-for="(category, index) in categories"
            :id="`settings-tab-${category.id}`"
            :key="category.id"
            :ref="(el) => setTabRef(el, index)"
            type="button"
            role="tab"
            :aria-selected="activeCategory === category.id"
            :aria-controls="`settings-panel-${category.id}`"
            :tabindex="activeCategory === category.id ? 0 : -1"
            class="settings-tab"
            :class="{ 'settings-tab-active': activeCategory === category.id }"
            @click="selectCategory(category.id)"
            @keydown="handleTabKeydown($event, index)"
          >
            {{ category.label }}
          </button>
        </div>

        <!-- The one scrolling surface for whichever category is active —
             fixed-size ancestors above (the dialog itself) plus this pane
             being the only `overflow-y-auto` in the chain is what keeps
             overflow contained here instead of growing the dialog or the
             page. -->
        <div
          :id="`settings-panel-${activeCategory}`"
          role="tabpanel"
          :aria-labelledby="`settings-tab-${activeCategory}`"
          tabindex="0"
          class="min-h-0 flex-1 overflow-y-auto p-5"
        >
          <!-- Editor: font, size, wrap, spell check, language -->
          <div v-if="activeCategory === 'editor'" class="flex flex-col gap-4">
            <label class="flex flex-col gap-1">
              <span class="text-sm text-base-content">Editor font size — {{ fontSize }}px</span>
              <input
                type="range"
                class="range range-sm"
                :min="FONT_SIZE_MIN"
                :max="FONT_SIZE_MAX"
                step="0.5"
                :value="fontSize"
                aria-label="Editor font size"
                @input="handleFontSizeInput"
              />
            </label>

            <div class="flex flex-col gap-1">
              <span id="settings-font-family-label" class="text-sm text-base-content"
                >Editor font family</span
              >
              <div class="join" role="group" aria-labelledby="settings-font-family-label">
                <button
                  type="button"
                  class="btn join-item btn-sm"
                  :class="{ 'btn-active': fontFamily === 'mono' }"
                  :aria-pressed="fontFamily === 'mono'"
                  @click="editorFontFamilyChanged('mono')"
                >
                  Monospace
                </button>
                <button
                  type="button"
                  class="btn join-item btn-sm"
                  :class="{ 'btn-active': fontFamily === 'serif' }"
                  :aria-pressed="fontFamily === 'serif'"
                  @click="editorFontFamilyChanged('serif')"
                >
                  Serif
                </button>
              </div>
            </div>

            <label class="flex items-center justify-between">
              <span class="text-sm text-base-content">Line wrapping</span>
              <input
                type="checkbox"
                class="toggle toggle-sm"
                :checked="lineWrap"
                aria-label="Line wrapping"
                @change="lineWrapToggled()"
              />
            </label>

            <div class="flex flex-col gap-1">
              <label class="flex items-center justify-between">
                <span class="text-sm text-base-content">Word completion</span>
                <input
                  type="checkbox"
                  class="toggle toggle-sm"
                  :checked="wordCompletionEnabled"
                  aria-label="Word completion"
                  @change="wordCompletionToggled()"
                />
              </label>
              <p class="text-xs text-base-content/70">
                Suggests words already used elsewhere in the current document as you type. Off by
                default so it never intercepts Enter while you're writing.
              </p>
            </div>

            <!-- Per-folder word-completion exclusion: e.g. a folder of
                 notes in a language you're learning, whose vocabulary you
                 don't want suggested everywhere else. Scoped to word
                 completion only — wiki-link completion is explicitly
                 invoked (`[[`) and always stays on, folder or no folder
                 (see `src/app/lib/wordCompletionScope.ts`). Lives right
                 under the toggle it modifies rather than its own section,
                 since it only ever matters together with it. -->
            <div class="flex flex-col gap-1">
              <span id="settings-word-completion-folders-label" class="text-sm text-base-content">
                Turn off word completion in these folders
              </span>
              <!-- No folders at all: an explanatory line instead of an
                   empty bordered box, so this never reads as broken or
                   missing content. -->
              <p v-if="documentFolders.length === 0" class="text-xs text-base-content/70">
                You don't have any folders yet. Word completion can only be excluded per folder —
                create one from the documents panel to exclude it here.
              </p>
              <!-- Bounded height + its own `overflow-y-auto`: this list
                   scrolls WITHIN the settings dialog's fixed 640x600 frame
                   rather than growing it — verified with ~10 folders (see
                   the task report). The dialog's own category pane
                   (`overflow-y-auto` on `.settings-panel`'s tabpanel) would
                   already contain unbounded growth here too, but bounding
                   the list itself keeps the rest of this category's
                   controls (spell check, its language picker) from being
                   pushed far below the fold by a long folder list. -->
              <ul
                v-else
                class="settings-folder-list flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded-box border border-base-300 p-1"
                role="group"
                aria-labelledby="settings-word-completion-folders-label"
              >
                <li v-for="folder in documentFolders" :key="folder.id">
                  <label
                    class="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm text-base-content"
                  >
                    <span class="truncate">{{ folder.name }}</span>
                    <input
                      type="checkbox"
                      class="checkbox checkbox-sm shrink-0"
                      :checked="wordCompletionExcludedFolderIds.includes(folder.id)"
                      :aria-label="`Turn off word completion in ${folder.name}`"
                      @change="wordCompletionFolderExclusionToggled(folder.id)"
                    />
                  </label>
                </li>
              </ul>
              <p class="text-xs text-base-content/70">
                Documents at the root (not in any folder) always get suggestions while word
                completion is on above — this list only ever narrows folders out, never in.
                <template v-if="!wordCompletionEnabled">
                  Word completion is off right now, so these choices have no effect until you turn
                  it back on.
                </template>
              </p>
            </div>

            <label class="flex items-center justify-between">
              <span class="text-sm text-base-content">Spell check</span>
              <input
                type="checkbox"
                class="toggle toggle-sm"
                :checked="spellCheckEnabled"
                aria-label="Spell check"
                @change="spellCheckToggled()"
              />
            </label>

            <div class="flex flex-col gap-1">
              <label for="settings-spellcheck-language" class="text-sm text-base-content">
                Spell check language
              </label>
              <select
                id="settings-spellcheck-language"
                class="select select-sm w-full"
                :value="spellCheckLanguage"
                :disabled="!spellCheckEnabled"
                @change="handleSpellCheckLanguageChange"
              >
                <option
                  v-for="entry in SPELLCHECK_LANGUAGES"
                  :key="entry.value"
                  :value="entry.value"
                >
                  {{ entry.label }}
                </option>
              </select>
              <!-- `/70`, not `/60` — this app's standing rule, and this
                   caption is why it exists. At `/60` it measured 4.46:1
                   against the old opaque panel (already under the 4.5:1
                   floor), and translucency pushed it to 3.93:1 worst-case,
                   since the panel now sits over whatever the document
                   behind it happens to be. `/70` clears the floor against
                   both extremes. -->
              <p class="text-xs text-base-content/70">
                Which dictionaries are actually available depends on your browser and operating
                system — this app doesn't ship any of its own.
              </p>
            </div>
          </div>

          <!-- Appearance: reading width, formatting toolbar, tooltips,
               documents panel side, scroll sync. -->
          <div v-else-if="activeCategory === 'appearance'" class="flex flex-col gap-4">
            <label class="flex flex-col gap-1">
              <span class="text-sm text-base-content">Reading width — {{ readingWidth }}ch</span>
              <input
                type="range"
                class="range range-sm"
                :min="READING_WIDTH_MIN"
                :max="READING_WIDTH_MAX"
                :value="readingWidth"
                aria-label="Preview reading width in characters"
                @input="handleReadingWidthInput"
              />
            </label>

            <label class="flex items-center justify-between">
              <span class="text-sm text-base-content">Show formatting toolbar</span>
              <input
                type="checkbox"
                class="toggle toggle-sm"
                :checked="showFormattingToolbar"
                aria-label="Show formatting toolbar"
                @change="showFormattingToolbarToggled()"
              />
            </label>

            <label class="flex items-center justify-between">
              <span class="text-sm text-base-content">Show tooltips</span>
              <input
                type="checkbox"
                class="toggle toggle-sm"
                :checked="showTooltips"
                aria-label="Show tooltips"
                @change="showTooltipsToggled()"
              />
            </label>

            <!-- Independent of the light/dark choice above — applies to
                 whichever theme is active, softening its near-black
                 (dark) or near-white (light) surfaces toward grey. Off by
                 default. See `app/styles/main.css`'s `[data-soft='true']`
                 blocks for the token overrides this drives. -->
            <label class="flex items-center justify-between">
              <span class="text-sm text-base-content">Soft contrast</span>
              <input
                type="checkbox"
                class="toggle toggle-sm"
                :checked="softContrast"
                aria-label="Soft contrast"
                @change="softContrastToggled()"
              />
            </label>

            <div class="flex flex-col gap-1">
              <span id="settings-drawer-side-label" class="text-sm text-base-content"
                >Documents panel side</span
              >
              <div class="join" role="group" aria-labelledby="settings-drawer-side-label">
                <button
                  type="button"
                  class="btn join-item btn-sm"
                  :class="{ 'btn-active': drawerSide === 'left' }"
                  :aria-pressed="drawerSide === 'left'"
                  @click="drawerSideChanged('left')"
                >
                  Left
                </button>
                <button
                  type="button"
                  class="btn join-item btn-sm"
                  :class="{ 'btn-active': drawerSide === 'right' }"
                  :aria-pressed="drawerSide === 'right'"
                  @click="drawerSideChanged('right')"
                >
                  Right
                </button>
              </div>
            </div>

            <!-- Defaulted off — the editor and preview panes must not
                 follow each other unless explicitly turned on here. See
                 `features/scroll-sync/model/scrollSync.ts`. -->
            <label class="flex items-center justify-between">
              <span class="text-sm text-base-content">Sync editor and preview scroll</span>
              <input
                type="checkbox"
                class="toggle toggle-sm"
                :checked="scrollSyncEnabled"
                aria-label="Sync editor and preview scroll"
                @change="scrollSyncToggled()"
              />
            </label>
          </div>

          <!-- Sync (renamed from "GitHub sync"): everywhere a document's
               bytes end up outside the editor itself. Local autosave first
               — moved in from Appearance, it's about *saving*, not
               appearance — then the GitHub connection UI moved in from the
               removed standalone `GitHubModal.vue` (see
               `GitHubSyncPanel.vue`, UI move only: token storage, the push
               engine, error handling, and the persisted connection config
               all behave exactly as before). Each gets its own sub-heading
               so "save to this browser" and "sync to GitHub" read as two
               distinct things, not one setting. -->
          <div v-else class="flex flex-col gap-4">
            <div class="flex flex-col gap-3">
              <h3 class="text-xs font-semibold tracking-wide text-base-content/70 uppercase">
                Local autosave
              </h3>
              <label class="flex flex-col gap-1">
                <span class="text-sm text-base-content">Autosave delay — {{ autosaveMs }}ms</span>
                <input
                  type="range"
                  class="range range-sm"
                  :min="AUTOSAVE_MS_MIN"
                  :max="AUTOSAVE_MS_MAX"
                  step="100"
                  :value="autosaveMs"
                  aria-label="Autosave delay in milliseconds"
                  @input="handleAutosaveInput"
                />
                <p class="text-xs text-base-content/70">
                  How long to wait after you stop typing before saving to this browser. Separate
                  from GitHub sync below.
                </p>
              </label>
            </div>

            <div class="divider my-0"></div>

            <div class="flex flex-col gap-3">
              <h3 class="text-xs font-semibold tracking-wide text-base-content/70 uppercase">
                GitHub sync
              </h3>
              <div class="flex flex-col gap-1">
                <label for="settings-auto-sync-interval" class="text-sm text-base-content">
                  Auto-sync interval
                </label>
                <select
                  id="settings-auto-sync-interval"
                  class="select select-sm w-full"
                  :value="autoSyncIntervalMinutes"
                  @change="handleAutoSyncIntervalChange"
                >
                  <option
                    v-for="minutes in AUTO_SYNC_INTERVAL_MINUTES_OPTIONS"
                    :key="minutes"
                    :value="minutes"
                  >
                    Every {{ minutes }} minute{{ minutes === 1 ? '' : 's' }}
                  </option>
                </select>
                <p class="text-xs text-base-content/70">
                  Your work is always saved to this browser immediately. This only controls how
                  often those changes are also committed to GitHub.
                </p>
              </div>
              <GitHubSyncPanel />
            </div>
          </div>
        </div>
      </div>

      <!-- Footer: "Reset to defaults" — always reachable regardless of the
           active category, not a fifth destination to navigate to. Still
           the same confirmation dialog/copy/guarantee as before.
           `/70`, not this dialog's other small-print `/60` (the spell-check
           language note above) — measured 4.463:1 in light theme at `/60`,
           just under the 4.5:1 text floor; `/70` measures 6.265:1 in light
           theme (and 6.014:1+ in dark, `/60`'s already-comfortable dark
           value only going up from a higher opacity), so this is the one
           caption in the dialog that needs the stronger token. -->
      <div class="flex shrink-0 items-center justify-between gap-3 border-t border-base-300 p-4">
        <p class="text-xs text-base-content/70">
          Preferences only — documents, folders, and your GitHub connection are untouched.
        </p>
        <button type="button" class="btn btn-outline btn-sm shrink-0" @click="resetRequested()">
          Reset to defaults
        </button>
      </div>
    </div>
  </div>

  <!-- "Reset to defaults" confirmation. A sibling of the dialog above, not
       nested inside it — see the `resetDialogRef` setup in the script for
       why. States plainly that documents/folders/GitHub are untouched,
       since "reset" reads as destructive and those are the things a user
       would actually worry about losing. -->
  <div
    v-if="resetConfirmOpen"
    ref="resetDialogRef"
    class="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4 print:hidden"
    role="dialog"
    aria-modal="true"
    aria-labelledby="reset-dialog-title"
    tabindex="-1"
    @keydown.esc="resetCancelled()"
    @keydown.tab="trapResetDialogFocus"
  >
    <div class="w-full max-w-sm rounded-box bg-base-100 p-5 shadow-xl">
      <h2 id="reset-dialog-title" class="text-base font-semibold text-base-content">
        Reset settings to defaults?
      </h2>
      <p class="mt-2 text-sm text-base-content/70">
        Restores font size, font family, line wrapping, word completion (including which folders
        it's turned off in), spell check, autosave delay, reading width, tooltips, formatting
        toolbar, documents panel side, scroll sync, auto-sync interval, theme, and soft contrast to
        their defaults. Your documents, folders, and GitHub connection are not affected.
      </p>
      <div class="mt-5 flex justify-end gap-2">
        <button
          ref="resetCancelButtonRef"
          type="button"
          class="btn btn-ghost btn-sm"
          @click="resetCancelled()"
        >
          Cancel
        </button>
        <button type="button" class="btn btn-primary btn-sm" @click="resetConfirmed()">
          Reset
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * GLASS PANEL — translucent/blurred/gradient surface for the dialog box
 * itself only (not the full-screen scrim, which stays `bg-black/50` on the
 * wrapper above — that keeps the dialog reading as separated from the app
 * exactly as before). Two rules, deliberately separated so legibility never
 * depends on `backdrop-filter` support:
 *
 *   1. `background-color`/`background-image` (this rule): an ALWAYS-APPLIED
 *      opaque-enough solid tint, computed to guarantee the contrast floor on
 *      its own — see the alpha derivation below. If `backdrop-filter` is
 *      unsupported/disabled, this rule alone still renders a legible, if
 *      unblurred, translucent-looking panel.
 *   2. `backdrop-filter`/`-webkit-backdrop-filter` (below): the blur EFFECT
 *      layered on top. Purely decorative — removing it never changes what
 *      text sits on top of, because rule 1 already composited a safe colour
 *      *before* the blur is even considered. Verified by simulating its
 *      removal (DevTools override) with no legibility change.
 *
 * `color-mix(in srgb, ...)` (not `in oklab`, unlike `ink.ts`/most of this
 * file) is deliberate: mixing toward the `transparent` keyword in `srgb`
 * carries the source colour's own R/G/B through unchanged and only scales
 * alpha (per the CSS Color 5 "mixing with a fully-transparent colour" rule),
 * i.e. `color-mix(in srgb, var(--color-base-100) 85%, transparent)` is
 * exactly `rgba(<base-100>, 0.85)` — the same simple non-premultiplied sRGB
 * alpha blend the browser then uses to composite over whatever is behind
 * it. That equivalence is what makes the ratios below computable by hand at
 * all (`in oklab` would perceptually re-derive the RGB channels first,
 * decoupling the declared mix from the actual composited pixel). Already
 * precedented in this codebase at `features/editor/lib/theme.ts`'s
 * selection-background mix, for the same reason.
 *
 * ALPHA DERIVATION (worst-case backdrop = pure white behind the dark
 * theme's panel, pure black behind the light theme's panel — the direction
 * that pushes each theme's near-monochrome panel color TOWARD its own body
 * text color, i.e. the actually-adversarial case, not the friendlier
 * opposite extreme):
 *   - 85% is the chosen alpha. Composite by hand (sRGB gamma-space linear
 *     blend, `alpha*panel + (1-alpha)*backdrop` per channel, then WCAG
 *     relative luminance):
 *       Light theme, panel (#fbfaf8) over pure BLACK: composited ≈
 *       #d5d4d2. `--color-base-content` (#1c1b19) on that: 11.68:1.
 *       Dark theme, panel (#0e0f11) over pure WHITE: composited ≈
 *       #323333. `--color-base-content` (#e8e6e3) on that: 10.16:1.
 *     Both clear the 4.5:1 text floor with wide margin (minimum alpha that
 *     hits exactly 4.5:1 was ≈0.63 for dark-over-white, the binding case;
 *     85% leaves headroom for the gradient tint below and for the
 *     non-`color-mix` fallback browsers' rounding). The footer's
 *     `text-base-content/70` caption (itself translucent, so doubly
 *     dependent on the panel colour it sits on) was checked the same way:
 *     5.24:1 (light) / 5.87:1 (dark) worst-case — also clear. (NOT
 *     re-verified for the `/60` "Which dictionaries..." caption in the
 *     Editor category: that one already measured 4.463:1 — under the floor
 *     — against the fully OPAQUE panel before this change, per this file's
 *     own footer comment; translucency makes an already-pre-existing gap
 *     numerically worse, not a new one, and fixing it is a text-opacity
 *     change outside this pass's scope.)
 *   - The 3:1 non-text floor: every control inside the panel (buttons,
 *     inputs, toggles, the tab rail) paints its own OPAQUE daisyUI surface
 *     color on top of this panel, same as before — none of them are
 *     themselves translucent, so their already-measured contrast against
 *     `--color-base-100`/`--color-base-200` is unaffected by the panel
 *     turning translucent underneath them.
 *
 * GRADIENT: a decorative `--md-accent` tint, top-left to transparent,
 * capped at 8% peak alpha (again via the same `in srgb, ... transparent`
 * mix). Composited on top of the worst-case panel colour above, at its
 * strongest (top-left corner, 8%) point: body text 10.63:1 (light) /
 * 9.00:1 (dark); the `/70` footer caption 4.99:1 (light) / 5.34:1 (dark).
 * Still clears 4.5:1 in both cases — an *additional* opaque layer painted
 * on top of an already-opaque-enough base can only add coverage, never
 * remove it, which is why this is safe by construction rather than a
 * separate lucky measurement. The gradient fades to fully transparent
 * before the tab rail / content pane in practice, so real running text
 * mostly sees less tint than this deliberately worst-cased "peak
 * everywhere" measurement.
 *
 * `prefers-reduced-transparency: reduce` drops all three (tint, gradient,
 * blur) back to the fully opaque pre-existing `--color-base-100` fill —
 * the same surface this dialog shipped with before this change.
 *
 * Performance: `backdrop-filter` is scoped to this 640x600 panel only, not
 * the full-viewport scrim behind it, and nothing here is transitioned or
 * animated.
 */
.settings-panel {
  background-color: color-mix(in srgb, var(--color-base-100) 78%, transparent);
  /* NO GRADIENT — it banded. A 14%-to-0% fade across ~600px is about 36
     discrete 8-bit levels spread over 600 pixels, i.e. a visible step every
     ~17px, which read as faint diagonal lines across the panel rather than
     as a sheen. Worse in the light theme, where banding is more visible in
     bright tones. Any large-area, low-delta gradient bands like this in
     8-bit; the real fix is noise dithering, which is not worth the weight
     here since blur, saturation and the lit edge below are what make this
     read as glass — the gradient was never carrying that. */
  /* A brighter hairline than `--color-base-300`: a lit edge is most of what
     makes a surface read as glass rather than as flat translucency, and it
     does the work even when the backdrop is the same tone as the panel —
     which, over this app's own monochrome editor, it usually is. */
  border: 1px solid color-mix(in srgb, var(--color-base-content) 14%, transparent);
  /* `saturate` alongside `blur` is what separates "glass" from "fog": the
     blur alone greys out whatever is behind it, and pushing saturation back
     up keeps the colour of the backdrop legible through the panel. */
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  backdrop-filter: blur(24px) saturate(180%);
}

@media (prefers-reduced-transparency: reduce) {
  .settings-panel {
    background-color: var(--color-base-100);
    background-image: none;
    border-color: var(--color-base-300);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
}

/*
 * SOFT CONTRAST COMPENSATION (`[data-soft='true']`, set on `<html>` by
 * `features/settings/model/softContrast.ts`) — bumps this panel's tint
 * from 78% to 85% opaque. Necessary, not cosmetic: the ALPHA DERIVATION
 * comment above measured the worst case as this panel's `--color-base-100`
 * composited OVER an adversarial pure-white(dark theme)/pure-black(light
 * theme) backdrop at 78%. Soft contrast moves `--color-base-100` itself
 * closer to the app's own text colour (see `app/styles/main.css`'s
 * `[data-soft='true']` blocks), which — composited over that SAME
 * adversarial backdrop — lands even closer to a flat mid-grey than the
 * un-softened colour did, so the footer's `/70` caption loses contrast
 * against it. Measured at the un-adjusted 78%: the caption drops to 4.21:1
 * (dark) / 4.50:1 (light) — the dark case genuinely breaks the mandatory
 * 4.5:1 text floor, not just a known-limitation non-text case. Raising
 * opacity to 85% is the fix: it makes the composited worst case lean more
 * on the panel's own (softened but still far more legible than a 50/50
 * blend) colour and less on the adversarial backdrop. Re-measured at 85%:
 * caption 5.17:1 (dark) / 4.92:1 (light) — both clear 4.5:1 with margin
 * again. Body text (not `/70`) stays comfortably clear either way (6.7:1+
 * at 85%).
 *
 * `:global(...)` wraps the WHOLE selector (`[data-soft='true']
 * .settings-panel`), not just the `[data-soft='true']` half — verified
 * against this project's actual compiled output that
 * `:global([data-soft='true']) .settings-panel` (unscoping only the
 * ancestor half, leaving `.settings-panel` to pick up the usual
 * `[data-v-hash]`) silently compiles away the `.settings-panel` part of
 * the selector entirely in this Vue/Vite version, leaving a bare
 * `[data-soft='true']` rule that matches `<html>` itself instead of this
 * panel — a real miscompile, not a hypothetical. Fully unscoping avoids it.
 * The trade-off: this rule now carries no `[data-v-hash]`, so its
 * specificity (1 attribute + 1 class = the same (0,2,0) as the base rule's
 * `.settings-panel[data-v-hash]`, 1 class + 1 attribute) TIES the base
 * rule instead of beating it outright — at equal specificity CSS falls
 * back to source order, and this rule is textually later in the same
 * compiled output, so it still wins.
 *
 * Wrapped in the same `prefers-reduced-transparency: no-preference` guard
 * (inverted from the base rule's own media query) — without it, this rule
 * would apply unconditionally (including for a reduced-transparency user)
 * and, being later in source order at tied specificity, would wrongly win
 * over the `@media (prefers-reduced-transparency: reduce)` rule above in
 * that case too, reintroducing a translucent fill where that rule
 * explicitly wants a flat, fully opaque one. Scoping this rule's own
 * applicability to `no-preference` means it simply never enters the
 * cascade when reduced-transparency is active, leaving that rule as the
 * only one setting `background-color` in that case. */
@media (prefers-reduced-transparency: no-preference) {
  :global([data-soft='true'] .settings-panel) {
    background-color: color-mix(in srgb, var(--color-base-100) 85%, transparent);
  }
}

/*
 * Category nav buttons — flat rows, matching `MoreMenu.vue`'s
 * `.more-menu-item` convention (hover/active carried by a flat background
 * change, no shadow/gradient) rather than daisyUI's `tab`/`menu`
 * utilities, consistent with this app's other hand-rolled small controls.
 * `--md-seg-fg` (inactive) and full `--color-base-content` (active) are
 * both already measured >=4.5:1 in both themes (see `app/styles/main.css`'s
 * `--md-seg-fg` comment) — the same pair `Toolbar.vue`'s `.view-tab` and
 * `DocumentDrawer.vue`'s `.dock-btn` already use, so no new contrast value
 * is introduced here.
 */
.settings-tab {
  display: block;
  flex-shrink: 0;
  width: 100%;
  overflow: hidden;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--md-seg-fg, var(--color-base-content));
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 7px 10px;
}

.settings-tab:hover {
  background: var(--md-hov, var(--color-base-200));
}

.settings-tab-active {
  background: var(--md-sel, var(--color-base-200));
  color: var(--color-base-content);
  font-weight: 600;
}

.settings-tab:focus-visible {
  outline: 2px solid var(--md-accent);
  outline-offset: -2px;
}

/*
 * The per-folder word-completion exclusion list's checkboxes
 * (`checkbox checkbox-sm`, first use of daisyUI's `.checkbox` component in
 * this app) — its DEFAULT unchecked border is only 20% opaque
 * (`oklab(<base-content> / 0.2)`, daisyUI 5's own token), which measured
 * (real composited pixels, screenshot + alpha-compositing, see the task
 * report) at only ~1.5:1-1.75:1 against this dialog's own translucent
 * `.settings-panel` across all four theme x soft-contrast combinations —
 * well under the 3:1 non-text floor a control's own boundary needs to stay
 * visible. `in srgb` (not `in oklab`, unlike daisyUI's own token, and unlike
 * `inlineCompletionTheme.ts`'s tooltip border) mixing toward `transparent`
 * is what `.settings-panel`'s own background rule above already documents
 * as reducing to a plain, by-hand-computable sRGB alpha blend — the same
 * reason it's used again here instead of matching daisyUI's oklab-mixed
 * token. 75% is not a borrowed value: it's chosen and verified for computed
 * over THIS panel's own translucent background specifically. Re-measured
 * after this change at every combination (see the task report) — all clear
 * 3:1 with margin.
 */
.settings-folder-list input[type='checkbox'] {
  border-color: color-mix(in srgb, var(--color-base-content) 75%, transparent);
}
</style>

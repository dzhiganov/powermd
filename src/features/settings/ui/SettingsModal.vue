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
  editorFontSizeChanged,
  editorFontFamilyChanged,
  lineWrapToggled,
  autosaveDebounceChanged,
  readingWidthChanged,
  spellCheckToggled,
  spellCheckLanguageChanged,
  SPELLCHECK_LANGUAGES,
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  AUTOSAVE_MS_MIN,
  AUTOSAVE_MS_MAX,
  READING_WIDTH_MIN,
  READING_WIDTH_MAX,
  type SpellCheckLanguage,
} from '../model/editorPreferences'
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
} from '../model/uiPreferences'
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
const showTooltips = useUnit($showTooltips)
const drawerSide = useUnit($drawerSide)
const showFormattingToolbar = useUnit($showFormattingToolbar)
const scrollSyncEnabled = useUnit($scrollSyncEnabled)

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
    class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 print:hidden"
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
      class="flex h-[600px] max-h-[calc(100dvh-2rem)] w-[640px] max-w-[calc(100dvw-2rem)] flex-col rounded-box bg-base-100 shadow-xl"
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
              <p class="text-xs text-base-content/60">
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
        Restores font size, font family, line wrapping, spell check, autosave delay, reading width,
        tooltips, formatting toolbar, documents panel side, scroll sync, and theme to their
        defaults. Your documents, folders, and GitHub connection are not affected.
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
</style>

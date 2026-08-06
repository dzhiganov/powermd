<script setup lang="ts">
import { ref } from 'vue'
import { useUnit } from 'effector-vue/composition'
import { XMarkIcon } from '@heroicons/vue/24/outline'

import { useDialogFocusTrap } from '@/shared/lib/useDialog'

import {
  $editorFontSize,
  $editorFontFamily,
  $lineWrapEnabled,
  $autosaveDebounceMs,
  $readingWidthCh,
  editorFontSizeChanged,
  editorFontFamilyChanged,
  lineWrapToggled,
  autosaveDebounceChanged,
  readingWidthChanged,
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  AUTOSAVE_MS_MIN,
  AUTOSAVE_MS_MAX,
  READING_WIDTH_MIN,
  READING_WIDTH_MAX,
} from '../model/editorPreferences'
import { $settingsOpen, settingsClosed } from '../model/dialogs'
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
    <div class="w-full max-w-md rounded-box bg-base-100 p-5 shadow-xl">
      <div class="flex items-center justify-between">
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

      <div class="mt-4 flex flex-col gap-4">
        <!-- No theme control here — the header's `ThemeToggle` (always
             visible, next to the sync indicator) is the only one now. A
             second copy in this modal was redundant with it. -->
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
          <span class="text-sm text-base-content">Show tooltips</span>
          <input
            type="checkbox"
            class="toggle toggle-sm"
            :checked="showTooltips"
            aria-label="Show tooltips"
            @change="showTooltipsToggled()"
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

        <!-- Defaulted off — the editor and preview panes must not follow
             each other unless explicitly turned on here. See
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
        </label>

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

        <div class="mt-2 border-t border-base-300 pt-4">
          <button type="button" class="btn btn-outline btn-sm w-full" @click="resetRequested()">
            Reset to defaults
          </button>
        </div>
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
        Restores font size, font family, line wrapping, autosave delay, reading width, tooltips,
        formatting toolbar, documents panel side, scroll sync, and theme to their defaults. Your
        documents, folders, and GitHub connection are not affected.
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

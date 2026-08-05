<script setup lang="ts">
import { ref } from 'vue'
import { useUnit } from 'effector-vue/composition'
import { XMarkIcon } from '@heroicons/vue/24/outline'

import { useDialogFocusTrap } from '@/shared/lib/useDialog'

import ThemeToggle from './ThemeToggle.vue'
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
        <div class="flex items-center justify-between">
          <!-- `ThemeToggle` already carries its own descriptive
               `aria-label` ("Switch to light/dark theme") on its button
               root, so this is a plain visual label rather than an
               `aria-labelledby` target — the latter would override (not
               combine with) that per-state label. -->
          <span class="text-sm text-base-content">Theme</span>
          <ThemeToggle />
        </div>

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
      </div>
    </div>
  </div>
</template>

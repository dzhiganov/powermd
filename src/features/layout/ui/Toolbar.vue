<script setup lang="ts">
import { useUnit } from 'effector-vue/composition'
import { DocumentTextIcon, EyeIcon, ViewColumnsIcon } from '@heroicons/vue/24/outline'
import type { Component } from 'vue'

import { ThemeToggle, HelpButton, SettingsButton, $showTooltips } from '@/features/settings'
import { DrawerToggleButton, DocumentTitle } from '@/features/documents'
import { ImportButton, ExportMenu } from '@/features/transfer'

import { $viewMode, viewModeChanged } from '../model/layout'
import type { ViewMode } from '../model/layout'

// The drawer side ('left' | 'right') still comes in as a prop — `layout`
// already reads `$drawerSide` in `AppShell.vue` (the single mounting site)
// to thread it to `DocumentDrawer.vue`, so it's threaded here the same way
// — but the header itself no longer reacts to it (see template comment
// below). The prop stays so the drawer can still be told which side it
// docks on without a second independent read of the same store.
withDefaults(defineProps<{ side?: 'left' | 'right' }>(), { side: 'right' })

const viewMode = useUnit($viewMode)
const showTooltips = useUnit($showTooltips)

interface ViewModeOption {
  value: ViewMode
  label: string
  icon: Component
}

// Order matches how the switcher reads left to right: editor | both | view.
// All three segments stay on the outline icon variant in both states (the
// user doesn't want the icon shape to change) — the active segment is
// instead distinguished with a `btn-primary` fill, which reads as a much
// stronger, unambiguous background change than daisyUI's own subtle
// `btn-active` (base-200 mixed with 5% black) would on its own.
const viewModeOptions: ViewModeOption[] = [
  { value: 'editor', label: 'Only editor', icon: DocumentTextIcon },
  { value: 'split', label: 'Both', icon: ViewColumnsIcon },
  { value: 'preview', label: 'Only view', icon: EyeIcon },
]
</script>

<template>
  <!-- Static layout: the document name always sits at the left end and
       every instrument icon (drawer toggle, view-mode switcher, import,
       export, shortcuts, settings, theme) always sits at the right end,
       regardless of which side the drawer (`side`) actually docks on. This
       used to mirror with `side` — the user asked for that removed, since
       a toolbar that rearranges itself based on a setting read poorly.
       `justify-between` spreads the two fixed groups to the two ends. -->
  <header
    class="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-base-300 bg-base-200 px-4 print:hidden"
  >
    <div class="flex min-w-0 items-center gap-1">
      <DocumentTitle :show-tooltips="showTooltips" />
    </div>

    <div class="flex items-center gap-1">
      <DrawerToggleButton :show-tooltips="showTooltips" />

      <div class="join hidden md:flex" aria-label="View mode">
        <button
          v-for="option in viewModeOptions"
          :key="option.value"
          type="button"
          class="btn join-item btn-xs"
          :class="{ 'btn-primary': viewMode === option.value }"
          :aria-pressed="viewMode === option.value"
          :aria-label="option.label"
          :title="showTooltips ? option.label : undefined"
          @click="viewModeChanged(option.value)"
        >
          <component :is="option.icon" class="h-3.5 w-3.5" />
        </button>
      </div>

      <ImportButton />
      <ExportMenu />
      <HelpButton />
      <SettingsButton />
      <ThemeToggle />
    </div>
  </header>
</template>

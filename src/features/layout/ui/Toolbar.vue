<script setup lang="ts">
import { useUnit } from 'effector-vue/composition'
import {
  DocumentTextIcon as DocumentTextIconOutline,
  EyeIcon as EyeIconOutline,
  ViewColumnsIcon as ViewColumnsIconOutline,
} from '@heroicons/vue/24/outline'
import {
  DocumentTextIcon as DocumentTextIconSolid,
  EyeIcon as EyeIconSolid,
  ViewColumnsIcon as ViewColumnsIconSolid,
} from '@heroicons/vue/24/solid'
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
  iconOutline: Component
  iconSolid: Component
}

// Order matches how the switcher reads left to right: editor | both | view.
// The active segment swaps to the filled icon variant so the pressed state
// reads from icon shape, not just background/border tint (see toolbar spec).
const viewModeOptions: ViewModeOption[] = [
  {
    value: 'editor',
    label: 'Only editor',
    iconOutline: DocumentTextIconOutline,
    iconSolid: DocumentTextIconSolid,
  },
  {
    value: 'split',
    label: 'Both',
    iconOutline: ViewColumnsIconOutline,
    iconSolid: ViewColumnsIconSolid,
  },
  { value: 'preview', label: 'Only view', iconOutline: EyeIconOutline, iconSolid: EyeIconSolid },
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
          :class="{ 'btn-active': viewMode === option.value }"
          :aria-pressed="viewMode === option.value"
          :aria-label="option.label"
          :title="showTooltips ? option.label : undefined"
          @click="viewModeChanged(option.value)"
        >
          <component
            :is="viewMode === option.value ? option.iconSolid : option.iconOutline"
            class="h-3.5 w-3.5"
          />
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

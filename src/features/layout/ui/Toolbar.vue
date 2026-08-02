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

// The drawer side ('left' | 'right') comes in as a prop rather than a
// direct `@/features/settings` import — `layout` already reads
// `$drawerSide` in `AppShell.vue` (the single mounting site) to thread it
// to `DocumentDrawer.vue`, so it's threaded here the same way rather than
// having two independent reads of the same store.
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
  <!-- The drawer-toggle/title group tracks whichever side the drawer is
       docked on (`side`), rather than always sitting at the toolbar's left
       end — otherwise it visually points at empty space when the drawer is
       on the right. `justify-between` still spreads exactly two groups to
       the two ends; swapping which group is in DOM/visual `order` first is
       what actually relocates them, so `side="right"` clusters both groups
       at the right end (via `justify-end`) with the drawer group last —
       "right of the other right-hand controls" — while `side="left"` keeps
       the original spread-apart layout. -->
  <header
    class="flex h-12 shrink-0 items-center gap-3 border-b border-base-300 bg-base-200 px-4 print:hidden"
    :class="side === 'right' ? 'justify-end' : 'justify-between'"
  >
    <div class="flex min-w-0 items-center gap-1" :class="side === 'right' ? 'order-2' : 'order-1'">
      <DrawerToggleButton :show-tooltips="showTooltips" />
      <DocumentTitle :show-tooltips="showTooltips" />
    </div>

    <div class="flex items-center gap-1.5" :class="side === 'right' ? 'order-1' : 'order-2'">
      <div class="join hidden md:flex" aria-label="View mode">
        <button
          v-for="option in viewModeOptions"
          :key="option.value"
          type="button"
          class="btn join-item btn-sm"
          :class="{ 'btn-active': viewMode === option.value }"
          :aria-pressed="viewMode === option.value"
          :aria-label="option.label"
          :title="showTooltips ? option.label : undefined"
          @click="viewModeChanged(option.value)"
        >
          <component
            :is="viewMode === option.value ? option.iconSolid : option.iconOutline"
            class="h-4 w-4"
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

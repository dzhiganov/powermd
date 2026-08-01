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

import { ThemeToggle } from '@/features/settings'
import { DocumentMenuButton, SaveIndicator } from '@/features/documents'
import { ImportButton, ExportMenu } from '@/features/transfer'

import { $viewMode, viewModeChanged } from '../model/layout'
import type { ViewMode } from '../model/layout'

const viewMode = useUnit($viewMode)

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
  <header
    class="flex h-12 shrink-0 items-center justify-between border-b border-base-300 bg-base-200 px-4 print:hidden"
  >
    <div class="flex min-w-0 items-center gap-2">
      <DocumentMenuButton />
      <SaveIndicator class="hidden sm:flex" />
    </div>

    <div class="flex items-center gap-1.5">
      <div class="join hidden md:flex" aria-label="View mode">
        <button
          v-for="option in viewModeOptions"
          :key="option.value"
          type="button"
          class="btn join-item btn-sm"
          :class="{ 'btn-active': viewMode === option.value }"
          :aria-pressed="viewMode === option.value"
          :aria-label="option.label"
          :title="option.label"
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
      <ThemeToggle />
    </div>
  </header>
</template>

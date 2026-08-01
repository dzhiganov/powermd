<script setup lang="ts">
import { useUnit } from 'effector-vue/composition'

import { ThemeToggle } from '@/features/settings'

import { $viewMode, viewModeChanged } from '../model/layout'
import type { ViewMode } from '../model/layout'

const viewMode = useUnit($viewMode)

function handleViewModeChange(event: Event) {
  viewModeChanged((event.target as HTMLSelectElement).value as ViewMode)
}
</script>

<template>
  <header
    class="flex h-12 shrink-0 items-center justify-between border-b border-base-300 bg-base-200 px-4"
  >
    <div class="flex items-center gap-3">
      <span class="text-sm font-semibold text-base-content">Markdown Editor</span>
      <span class="hidden text-sm text-base-content/60 sm:inline">untitled.md</span>
    </div>

    <div class="flex items-center gap-1.5">
      <select
        class="select select-sm hidden md:flex"
        aria-label="View mode"
        :value="viewMode"
        @change="handleViewModeChange"
      >
        <option value="editor">Only editor</option>
        <option value="preview">Only view</option>
        <option value="split">Both</option>
      </select>

      <ThemeToggle />
    </div>
  </header>
</template>

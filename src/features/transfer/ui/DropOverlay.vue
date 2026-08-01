<script setup lang="ts">
import { useUnit } from 'effector-vue/composition'
import { ArrowUpTrayIcon } from '@heroicons/vue/24/outline'

import { $isDraggingFile } from '../model/transfer'

const dragging = useUnit($isDraggingFile)
</script>

<template>
  <div
    v-show="dragging"
    class="pointer-events-none fixed inset-0 z-[90] flex items-center justify-center border-4 border-dashed border-primary bg-primary/10 print:hidden"
    aria-hidden="true"
  >
    <div class="flex flex-col items-center gap-2 rounded-box bg-base-100/90 px-8 py-6 shadow-xl">
      <ArrowUpTrayIcon class="h-10 w-10 text-primary" />
      <p class="text-lg font-semibold text-base-content">Drop to import</p>
      <p class="text-sm text-base-content/60">Markdown or text files become new documents</p>
    </div>
  </div>
</template>

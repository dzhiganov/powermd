<script setup lang="ts">
import { useUnit } from 'effector-vue/composition'
import { XMarkIcon } from '@heroicons/vue/24/outline'

import { $toasts, toastDismissed } from '../lib/toast'

const toasts = useUnit($toasts)
</script>

<template>
  <div
    class="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 print:hidden"
    aria-live="polite"
    role="status"
  >
    <div
      v-for="toast in toasts"
      :key="toast.id"
      class="pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-box border px-3 py-2 text-sm shadow-xl"
      :class="{
        'border-warning/40 bg-warning/15 text-base-content': toast.tone === 'warning',
        'border-error/40 bg-error/15 text-base-content': toast.tone === 'error',
        'border-base-300 bg-base-200 text-base-content': toast.tone === 'info',
      }"
    >
      <span class="flex-1">{{ toast.text }}</span>
      <button
        type="button"
        class="btn btn-ghost btn-xs btn-square shrink-0"
        aria-label="Dismiss notification"
        @click="toastDismissed(toast.id)"
      >
        <XMarkIcon class="h-3.5 w-3.5" />
      </button>
    </div>
  </div>
</template>

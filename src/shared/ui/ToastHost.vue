<script setup lang="ts">
import { useUnit } from 'effector-vue/composition'
import { XMarkIcon } from '@heroicons/vue/24/outline'

import { $toasts, toastDismissed } from '../lib/toast'

const toasts = useUnit($toasts)
</script>

<template>
  <!-- `bottom-12` clears the 32px status bar rather than overlapping it.
       At `bottom-4` a toast sat across the bar's top border, so the bar's
       own hairline ran straight through the notification. -->
  <div
    class="pointer-events-none fixed inset-x-0 bottom-12 z-[100] flex flex-col items-center gap-2 px-4 print:hidden"
    aria-live="polite"
    role="status"
  >
    <div
      v-for="toast in toasts"
      :key="toast.id"
      class="toast-item pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-box border px-3 py-2 text-sm text-base-content shadow-xl"
      :class="{
        'toast-warning': toast.tone === 'warning',
        'toast-error': toast.tone === 'error',
        'toast-info': toast.tone === 'info',
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

<style scoped>
/*
 * OPAQUE TONES. The warning and error tones used `bg-warning/15` and
 * `bg-error/15` — a 15% alpha fill, which is to say 85% of whatever sat
 * behind the toast came through it. That read as the splitter and the
 * status bar's border drawing *over* the notification, but nothing was
 * drawing over anything: the toast is already the topmost painted element
 * (`z-[100]` at the app root, with no stacking-context ancestor to trap
 * it), it simply was not opaque enough to hide what it covered. Raising
 * z-index would have changed nothing.
 *
 * `color-mix` toward `--color-base-200` rather than toward `transparent`
 * keeps the same tinted look while being fully opaque, so the tone survives
 * and the surface actually covers. The info tone was already opaque
 * (`bg-base-200`) and keeps exactly the colours it had.
 */
.toast-item {
  background-color: var(--color-base-200);
  border-color: var(--color-base-300);
}

.toast-warning {
  background-color: color-mix(in srgb, var(--color-warning) 15%, var(--color-base-200));
  border-color: color-mix(in srgb, var(--color-warning) 40%, var(--color-base-200));
}

.toast-error {
  background-color: color-mix(in srgb, var(--color-error) 15%, var(--color-base-200));
  border-color: color-mix(in srgb, var(--color-error) 40%, var(--color-base-200));
}
</style>

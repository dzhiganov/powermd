<script setup lang="ts">
import { computed } from 'vue'
import { useUnit } from 'effector-vue/composition'

import { $saveStatus } from '../model/documents'

const status = useUnit($saveStatus)

const label = computed(() => {
  switch (status.value) {
    case 'error':
      return 'Not saved'
    case 'unsaved':
      return 'Saving…'
    default:
      return 'Saved'
  }
})

// `title` spells out the error path so a failed/unavailable IndexedDB is
// discoverable, not just a red dot.
const hint = computed(() =>
  status.value === 'error'
    ? 'Changes could not be saved — storage is unavailable or full. Your work is kept in memory for now.'
    : undefined,
)
</script>

<template>
  <span
    class="flex items-center gap-1.5 text-xs"
    :class="{
      'text-error': status === 'error',
      'text-base-content/50': status !== 'error',
    }"
    :title="hint"
    role="status"
    aria-live="polite"
  >
    <span
      class="h-2 w-2 rounded-full"
      :class="{
        'bg-error': status === 'error',
        'bg-warning': status === 'unsaved',
        'bg-success': status === 'saved',
      }"
      aria-hidden="true"
    />
    {{ label }}
  </span>
</template>

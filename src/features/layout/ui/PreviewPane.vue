<script setup lang="ts">
import { Preview } from '@/features/preview'

defineProps<{
  /** Whether this pane is the sole visible one (desktop editor-only or
   * preview-only, or any mobile state) — see `AppShell`'s `singlePane`. */
  centered?: boolean
}>()
</script>

<template>
  <section
    class="h-full min-w-0 flex-1 overflow-hidden bg-base-100 print:!static print:!block print:!h-auto print:!w-full print:!overflow-visible"
  >
    <Preview :centered="centered" />
  </section>
</template>

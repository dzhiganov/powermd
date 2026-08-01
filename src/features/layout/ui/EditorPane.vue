<script setup lang="ts">
import { Editor } from '@/features/editor'

defineProps<{
  /** Whether this pane is the sole visible one (desktop editor-only or
   * preview-only, or any mobile state) — see `AppShell`'s `singlePane`. */
  centered?: boolean
}>()
</script>

<template>
  <section class="h-full min-w-0 flex-1 overflow-hidden bg-base-100">
    <Editor class="h-full" :centered="centered" />
  </section>
</template>

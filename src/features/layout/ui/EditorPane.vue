<script setup lang="ts">
import { Editor, FormattingToolbar } from '@/features/editor'

defineProps<{
  /** Whether this pane is the sole visible one (desktop editor-only or
   * preview-only, or any mobile state) — see `AppShell`'s `singlePane`. */
  centered?: boolean
}>()
</script>

<template>
  <section class="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-base-100 print:hidden">
    <FormattingToolbar />
    <div class="min-h-0 flex-1">
      <Editor class="h-full" :centered="centered" />
    </div>
  </section>
</template>

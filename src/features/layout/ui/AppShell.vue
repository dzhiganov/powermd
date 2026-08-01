<script setup lang="ts">
import Toolbar from './Toolbar.vue'
import EditorPane from './EditorPane.vue'
import PreviewPane from './PreviewPane.vue'
</script>

<template>
  <div class="flex h-dvh flex-col overflow-hidden bg-base-100">
    <Toolbar />

    <main class="flex min-h-0 flex-1">
      <EditorPane />
      <div class="w-px shrink-0 bg-base-300" />
      <PreviewPane />
    </main>
  </div>
</template>

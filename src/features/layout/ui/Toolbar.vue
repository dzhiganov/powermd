<script setup lang="ts">
import { ThemeToggle } from '@/features/settings'
</script>

<template>
  <header
    class="flex h-12 shrink-0 items-center justify-between border-b border-base-300 bg-base-200 px-4"
  >
    <div class="flex items-center gap-3">
      <span class="text-sm font-semibold text-base-content">Markdown Editor</span>
      <span class="text-sm text-base-content/60">untitled.md</span>
    </div>

    <ThemeToggle />
  </header>
</template>

<script setup lang="ts">
import { AppShell } from '@/features/layout'
import { DropOverlay } from '@/features/transfer'
import ToastHost from '@/shared/ui/ToastHost.vue'
import UpdatePrompt from './UpdatePrompt.vue'
</script>

<template>
  <AppShell />
  <DropOverlay />
  <ToastHost />
  <UpdatePrompt />
</template>

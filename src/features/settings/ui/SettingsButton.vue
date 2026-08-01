<script setup lang="ts">
import { Cog6ToothIcon } from '@heroicons/vue/24/outline'

import { settingsOpened } from '../model/dialogs'
</script>

<template>
  <button
    type="button"
    class="btn btn-ghost btn-circle btn-sm"
    aria-label="Open settings"
    title="Settings"
    @click="settingsOpened()"
  >
    <Cog6ToothIcon class="h-5 w-5" />
  </button>
</template>

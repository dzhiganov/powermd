<script setup lang="ts">
import { Cog6ToothIcon } from '@heroicons/vue/24/outline'
import { useUnit } from 'effector-vue/composition'

import { settingsOpened } from '../model/dialogs'
import { $showTooltips } from '../model/uiPreferences'

const showTooltips = useUnit($showTooltips)
</script>

<template>
  <button
    type="button"
    class="btn btn-ghost btn-circle btn-sm"
    aria-label="Open settings"
    :title="showTooltips ? 'Settings' : undefined"
    @click="settingsOpened()"
  >
    <Cog6ToothIcon class="h-5 w-5" />
  </button>
</template>

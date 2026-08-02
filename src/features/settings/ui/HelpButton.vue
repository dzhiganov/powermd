<script setup lang="ts">
import { QuestionMarkCircleIcon } from '@heroicons/vue/24/outline'
import { useUnit } from 'effector-vue/composition'

import { helpOpened } from '../model/dialogs'
import { $showTooltips } from '../model/uiPreferences'

const showTooltips = useUnit($showTooltips)
</script>

<template>
  <button
    type="button"
    class="btn btn-ghost btn-circle btn-xs"
    aria-label="Open keyboard shortcuts"
    :title="showTooltips ? 'Keyboard shortcuts' : undefined"
    @click="helpOpened()"
  >
    <QuestionMarkCircleIcon class="h-3.5 w-3.5" />
  </button>
</template>

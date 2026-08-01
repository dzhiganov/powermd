<script setup lang="ts">
import { QuestionMarkCircleIcon } from '@heroicons/vue/24/outline'

import { helpOpened } from '../model/dialogs'
</script>

<template>
  <button
    type="button"
    class="btn btn-ghost btn-circle btn-sm"
    aria-label="Open keyboard shortcuts"
    title="Keyboard shortcuts"
    @click="helpOpened()"
  >
    <QuestionMarkCircleIcon class="h-5 w-5" />
  </button>
</template>

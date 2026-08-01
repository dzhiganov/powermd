<script setup lang="ts">
import { computed } from 'vue'
import { useUnit } from 'effector-vue/composition'
import { Bars3Icon } from '@heroicons/vue/24/outline'

import { $activeDocument, drawerToggled } from '../model/documents'

const active = useUnit($activeDocument)
const title = computed(() => active.value?.title || 'Untitled')
</script>

<template>
  <button
    type="button"
    class="btn btn-ghost btn-sm gap-2"
    aria-label="Open documents"
    :title="`Documents — ${title}`"
    @click="drawerToggled()"
  >
    <Bars3Icon class="h-4 w-4 shrink-0" />
    <span class="max-w-[10rem] truncate font-medium sm:max-w-[16rem]">{{ title }}</span>
  </button>
</template>

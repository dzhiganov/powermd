<script setup lang="ts">
import { computed } from 'vue'
import { useUnit } from 'effector-vue/composition'
import { SunIcon, MoonIcon } from '@heroicons/vue/24/outline'

import { THEMES } from '@/shared/config/theme'
import { $theme, themeToggled } from '../model/theme'

const theme = useUnit($theme)
const isDark = computed(() => theme.value === THEMES.dark)

function handleToggle() {
  themeToggled()
}
</script>

<template>
  <button
    type="button"
    class="btn btn-ghost btn-circle btn-sm"
    :aria-label="isDark ? 'Switch to light theme' : 'Switch to dark theme'"
    @click="handleToggle"
  >
    <SunIcon v-if="isDark" class="h-5 w-5" />
    <MoonIcon v-else class="h-5 w-5" />
  </button>
</template>

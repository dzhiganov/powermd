<script setup lang="ts">
import { computed } from 'vue'
import { useUnit } from 'effector-vue/composition'
import { SunIcon, MoonIcon, ComputerDesktopIcon, ClockIcon } from '@heroicons/vue/24/outline'

import { THEMES, type Theme } from '@/shared/config/theme'
import { $theme, themeCycled } from '../model/theme'

const theme = useUnit($theme)

// The main quick-cycle theme control in the app (Settings > Appearance also
// has a direct-pick segmented control — see `SettingsModal.vue` — for
// jumping straight to a mode without cycling through the others first), so
// this has to expose all four states, not just light/dark. Label describes
// what a click will switch *to* (matching the pre-existing "Switch to
// light/dark theme" copy), not the current state.
const NEXT_LABEL: Record<Theme, string> = {
  [THEMES.light]: 'Switch to dark theme',
  [THEMES.dark]: 'Switch to system theme',
  [THEMES.system]: 'Switch to schedule theme',
  [THEMES.schedule]: 'Switch to light theme',
}

const label = computed(() => NEXT_LABEL[theme.value])

function handleClick() {
  themeCycled()
}
</script>

<template>
  <button
    type="button"
    class="btn btn-ghost btn-circle btn-xs"
    :aria-label="label"
    @click="handleClick"
  >
    <SunIcon v-if="theme === THEMES.light" class="h-3.5 w-3.5" />
    <MoonIcon v-else-if="theme === THEMES.dark" class="h-3.5 w-3.5" />
    <ClockIcon v-else-if="theme === THEMES.schedule" class="h-3.5 w-3.5" />
    <ComputerDesktopIcon v-else class="h-3.5 w-3.5" />
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useUnit } from 'effector-vue/composition'
import { SunIcon, MoonIcon, ComputerDesktopIcon, ClockIcon } from '@heroicons/vue/24/outline'

import { THEMES, type Theme } from '@/shared/config/theme'
import { $theme, themeCycled } from '../model/theme'

// `menuItem`: renders as a full-width labelled row for
// `layout/ui/MoreMenu.vue`'s popover instead of a standalone icon button —
// same `themeCycled` call either way. This is now the only rendering used
// (the theme control moved off the documents panel's tools row into that
// menu, user request); the icon-button branch stays for any future toolbar.
withDefaults(defineProps<{ menuItem?: boolean }>(), { menuItem: false })

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

// Which theme a click lands on — drives the menu row's icon, so icon and
// label agree there ("Switch to dark theme" shows the moon). The icon-button
// branch deliberately shows the CURRENT theme's icon instead: a toggle
// button's job is to report state, a menu row's is to describe its action.
const NEXT_THEME: Record<Theme, Theme> = {
  [THEMES.light]: THEMES.dark,
  [THEMES.dark]: THEMES.system,
  [THEMES.system]: THEMES.schedule,
  [THEMES.schedule]: THEMES.light,
}

const label = computed(() => NEXT_LABEL[theme.value])
const nextTheme = computed(() => NEXT_THEME[theme.value])

function handleClick() {
  themeCycled()
}
</script>

<template>
  <!-- Menu row. Deliberately does NOT close the popover it sits in — every
       sibling item there does, so this is the one exception, and it is the
       point of the control: it CYCLES. A cycling row that closed after one
       step would turn "click twice to reach system" into "open the menu,
       click, reopen the menu, click", which is worse than the icon button
       this replaced rather than equal to it. Staying open lets the label and
       icon update in place under the cursor, so the next step is always one
       click away, and any click outside still dismisses as usual. -->
  <button
    v-if="menuItem"
    type="button"
    role="menuitem"
    class="popover-menu-item"
    :aria-label="label"
    @click="handleClick"
  >
    <SunIcon v-if="nextTheme === THEMES.light" class="h-3.5 w-3.5 shrink-0" />
    <MoonIcon v-else-if="nextTheme === THEMES.dark" class="h-3.5 w-3.5 shrink-0" />
    <ClockIcon v-else-if="nextTheme === THEMES.schedule" class="h-3.5 w-3.5 shrink-0" />
    <ComputerDesktopIcon v-else class="h-3.5 w-3.5 shrink-0" />
    {{ label }}
  </button>
  <button
    v-else
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

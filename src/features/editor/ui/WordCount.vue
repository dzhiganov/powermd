<script setup lang="ts">
import { useUnit } from 'effector-vue/composition'

import { $wordCount } from '../model/wordCount'

const count = useUnit($wordCount)
</script>

<template>
  <!-- Full-strength `text-base-content`, no opacity fade — see
       `shared/lib/ink.ts`'s doc comment on why faded/tinted foreground text
       is the recurring contrast trap in this app. `aria-live="off"`: this
       updates on every debounced keystroke tick, which would otherwise spam
       a screen reader constantly.

       The character count is hidden below the `sm` breakpoint (`hidden`,
       so it's dropped from the accessibility tree too, not just visually —
       `aria-live="off"` above means this was never announced anyway) — the
       bottom status bar this now lives in (`StatusBar.vue`) also carries
       the sync status alongside it, and the pair can overflow a narrow
       phone viewport otherwise. Word count alone still degrades sensibly:
       nothing is ever truncated mid-word. -->
  <span class="whitespace-nowrap text-xs text-base-content" aria-live="off">
    {{ count.words.toLocaleString() }} words
    <span class="hidden sm:inline">· {{ count.characters.toLocaleString() }} characters</span>
  </span>
</template>

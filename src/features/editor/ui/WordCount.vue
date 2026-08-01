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
       a screen reader constantly. -->
  <span class="text-xs text-base-content" aria-live="off">
    {{ count.words.toLocaleString() }} words · {{ count.characters.toLocaleString() }} characters
  </span>
</template>

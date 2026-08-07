<script setup lang="ts">
import { useUnit } from 'effector-vue/composition'

import { Editor, FormattingToolbar } from '@/features/editor'

import { $zenMode } from '../model/zen'

defineProps<{
  /** Whether this pane is the sole visible one (desktop editor-only or
   * preview-only, or any mobile state) — see `AppShell`'s `singlePane`. */
  centered?: boolean
}>()

const zenMode = useUnit($zenMode)
</script>

<template>
  <section class="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-base-100 print:hidden">
    <!-- Zen mode hides every piece of chrome except the text itself — the
         formatting toolbar counts as chrome. Wrapped in a plain
         `display:contents` div rather than a second `v-show` stacked
         directly on `FormattingToolbar` (which already carries its own
         internal `v-show` for the "show formatting toolbar" setting): two
         independent `v-show`s on one root element is unreliable, see
         `AppShell.vue`'s own `zenMode` doc comment for the same reasoning. -->
    <div v-show="!zenMode" class="contents">
      <FormattingToolbar />
    </div>
    <div class="min-h-0 flex-1">
      <Editor class="h-full" :centered="centered" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { useUnit } from 'effector-vue/composition'
import { Bars3Icon } from '@heroicons/vue/24/outline'

import { $drawerOpen, drawerToggled } from '../model/documents'

// `showTooltips` comes in as a prop rather than a direct `@/features/settings`
// import — `documents` and `settings` never import each other's internals
// (see ARCHITECTURE.md); the single mounting site (`Toolbar.vue`, in the
// `layout` feature) already imports `settings` directly and threads the
// value down.
defineProps<{ showTooltips?: boolean }>()

const open = useUnit($drawerOpen)
</script>

<template>
  <!-- This button does exactly one thing: toggle the drawer. The active
       document's title used to live inside this same control — it's now
       `DocumentTitle.vue`, a separate element, so clicking the title can
       rename without also toggling the drawer. -->
  <button
    type="button"
    class="btn btn-ghost btn-xs btn-square shrink-0"
    :aria-label="open ? 'Close documents' : 'Open documents'"
    :aria-pressed="open"
    :title="showTooltips ? (open ? 'Close documents' : 'Open documents') : undefined"
    @click="drawerToggled()"
  >
    <Bars3Icon class="h-3.5 w-3.5" />
  </button>
</template>

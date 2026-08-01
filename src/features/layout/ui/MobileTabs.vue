<script setup lang="ts">
import { useUnit } from 'effector-vue/composition'
import { DocumentTextIcon, EyeIcon } from '@heroicons/vue/24/outline'

import { $mobileTab, mobileTabChanged } from '../model/layout'

// `$mobileTab` is a view-only store seeded from `$viewMode` but never
// written back to it — tapping a tab here must not clobber the persisted
// desktop `split` preference (see `layout.ts`). These are really a
// two-state view toggle rather than an ARIA tabs widget: no panel pair
// exists to point `aria-controls` at and there's no arrow-key navigation,
// so they're plain toggle buttons (`aria-pressed`) instead of
// `role="tab"`.
const activeTab = useUnit($mobileTab)

function selectTab(tab: 'editor' | 'preview') {
  mobileTabChanged(tab)
}
</script>

<template>
  <div
    aria-label="Pane view"
    class="flex shrink-0 gap-1 border-b border-base-300 bg-base-200 px-2 py-1.5"
  >
    <button
      type="button"
      :aria-pressed="activeTab === 'editor'"
      class="mobile-tab flex flex-1 items-center justify-center gap-1.5 rounded-field px-3 py-1.5 text-sm font-medium text-base-content/60"
      :class="{ active: activeTab === 'editor' }"
      @click="selectTab('editor')"
    >
      <DocumentTextIcon class="h-4 w-4" />
      Editor
    </button>
    <button
      type="button"
      :aria-pressed="activeTab === 'preview'"
      class="mobile-tab flex flex-1 items-center justify-center gap-1.5 rounded-field px-3 py-1.5 text-sm font-medium text-base-content/60"
      :class="{ active: activeTab === 'preview' }"
      @click="selectTab('preview')"
    >
      <EyeIcon class="h-4 w-4" />
      Preview
    </button>
  </div>
</template>

<style scoped>
/* Raw `var(--color-*)` rather than Tailwind's `-primary`/`-base-100`
 * suffix utilities, matching the rest of the app's convention (see
 * Splitter.vue and `shared/lib/ink.ts`). */
.mobile-tab.active {
  background-color: var(--color-base-100);
  color: var(--color-base-content);
}

.mobile-tab:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}
</style>

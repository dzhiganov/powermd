<script setup lang="ts">
import { ref, watch } from 'vue'
import { useUnit } from 'effector-vue/composition'
import { ExclamationTriangleIcon } from '@heroicons/vue/24/outline'

import { ink } from '@/shared/lib/ink'

import { $saveStatus } from '../model/documents'

// See `DrawerToggleButton.vue` for why `side` is a prop rather than a
// direct `@/features/settings` import. Used here to anchor this indicator
// to the corner *opposite* the docked drawer, so it can never render over
// the drawer's own controls regardless of which side the drawer is on.
withDefaults(defineProps<{ side?: 'left' | 'right' }>(), { side: 'right' })

const status = useUnit($saveStatus)

// --- Phase 2 visual redesign ------------------------------------------
//
// The header's unsaved dot (`DocumentTitle.vue`) now owns the transient
// "pending/saving" and "just saved" flashes this component used to render
// in the viewport corner. What's left here is deliberately narrower and
// more insistent: a save *failure* only, and it never auto-hides. Losing
// sight of a failed save (quota exceeded, IndexedDB unavailable) would hide
// real, ongoing data loss — the retry-with-backoff behind `$saveStatus`
// (see `model/documents.ts`) keeps trying, but the user must be able to see
// that it hasn't succeeded yet for as long as that's true, not for a
// timed 2-second flash. Visible for the entire duration of `status ===
// 'error'`; hidden the instant a retry actually lands (`$saveStatus` flips
// back to 'saved' or 'unsaved', both handled below).
const visible = ref(false)

// --- Accessible announcement -------------------------------------------
//
// A polite live region announces every state change to screen-reader users,
// independent of the (now error-only) visual affordance — the announcement
// text is retained (not cleared) once set, so there is always a meaningful
// last-known status rather than a region that goes empty as soon as it
// stops being visually shown.
const announcement = ref('')

watch(
  status,
  (current) => {
    visible.value = current === 'error'
    if (current === 'error') {
      announcement.value =
        'Changes could not be saved — storage is unavailable or full. Your work is kept in memory and a retry is in progress.'
    } else if (current === 'unsaved') {
      announcement.value = 'Saving…'
    } else {
      announcement.value = 'Saved'
    }
  },
  { immediate: true },
)
</script>

<template>
  <!-- Fixed to the viewport corner opposite the docked drawer (`side`), so
       it can never sit over the drawer's own controls on either side.
       Purely a status readout: `pointer-events-none` so it never
       intercepts clicks, and `fixed` positioning so it never participates
       in layout / can never shift anything else. No fade/transition on
       visibility any more — appearing or disappearing must read as an
       immediate, unambiguous state change, not a soft flash. -->
  <div
    v-show="visible"
    class="pointer-events-none fixed bottom-3 z-30 flex items-center gap-1.5"
    :class="[side === 'right' ? 'left-3' : 'right-3']"
    role="status"
    aria-live="polite"
    aria-label="Save status"
  >
    <span class="sr-only">{{ announcement }}</span>
    <span
      class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-base-200 shadow"
      aria-hidden="true"
    >
      <ExclamationTriangleIcon class="h-3.5 w-3.5" :style="{ color: ink('--color-error') }" />
    </span>
    <span
      class="rounded-full bg-base-200 px-2 py-1 text-xs font-medium shadow"
      :style="{ color: ink('--color-error') }"
      aria-hidden="true"
    >
      Not saved
    </span>
  </div>
</template>

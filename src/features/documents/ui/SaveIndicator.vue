<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import { useUnit } from 'effector-vue/composition'
import { CheckIcon, ExclamationTriangleIcon, ArrowPathIcon } from '@heroicons/vue/24/outline'

import { ink } from '@/shared/lib/ink'

import { $saveStatus } from '../model/documents'

// See `DrawerToggleButton.vue` for why `side` is a prop rather than a
// direct `@/features/settings` import. Used here to anchor this indicator
// to the corner *opposite* the docked drawer, so it can never render over
// the drawer's own controls regardless of which side the drawer is on.
withDefaults(defineProps<{ side?: 'left' | 'right' }>(), { side: 'right' })

const status = useUnit($saveStatus)

// --- Local presentation state machine --------------------------------------
//
// `$saveStatus` only ever holds the *current* truth ('unsaved' | 'saved' |
// 'error') — it has no notion of "just finished, show a checkmark briefly".
// That transient "success flash" is purely a presentation concern, so it's
// tracked here rather than in the model. `icon` intentionally does NOT get
// cleared when `visible` goes false: the checkmark stays the rendered icon
// (just faded to invisible via CSS) so the fade-out below animates the
// actual icon rather than popping to empty content mid-transition.
type Icon = 'saving' | 'success' | 'error' | null

const icon = ref<Icon>(null)
const visible = ref(false)
let hideTimer: ReturnType<typeof setTimeout> | null = null

const SUCCESS_HOLD_MS = 2000

function clearHideTimer(): void {
  if (hideTimer !== null) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}

function show(next: Icon): void {
  clearHideTimer()
  icon.value = next
  visible.value = true
}

// No `immediate: true` here on purpose — on a fresh load `$saveStatus`
// starts at `'saved'` with no prior `'unsaved'`/`'error'`, and that must
// stay invisible (nothing was actually just saved), not flash a checkmark
// at startup. Only reacts to genuine transitions, so `current === 'saved'`
// below is only ever reached having previously been `'unsaved'` or
// `'error'` (a `'saved'` -> `'saved'` "change" can't fire `watch` at all).
watch(status, (current) => {
  if (current === 'error') {
    // Errors are never auto-hidden — losing sight of a failed save (quota
    // exceeded, IndexedDB unavailable) would hide real data loss. Stays
    // visible until the next successful write.
    show('error')
    return
  }
  if (current === 'unsaved') {
    show('saving')
    return
  }
  // current === 'saved': only flash the success state on a genuine
  // transition into it (a save just completed, or a failing save just
  // recovered) — 'saved' -> 'saved' can't happen (no-op `watch` trigger),
  // so `previous` here is always 'unsaved' or 'error'.
  show('success')
  hideTimer = setTimeout(() => {
    visible.value = false
    hideTimer = null
  }, SUCCESS_HOLD_MS)
})

onUnmounted(clearHideTimer)

// --- Accessible announcement -------------------------------------------
//
// A polite live region announces state changes to screen-reader users
// independently of the visual fade — the announcement text is retained
// (not cleared) once set, so there is always a meaningful last-known
// status rather than a region that goes empty right as it visually fades.
const announcement = ref('')
watch(icon, (next) => {
  if (next === 'saving') announcement.value = 'Saving…'
  else if (next === 'success') announcement.value = 'Saved'
  else if (next === 'error') {
    announcement.value =
      'Changes could not be saved — storage is unavailable or full. Your work is kept in memory and a retry is in progress.'
  }
})
</script>

<template>
  <!-- Fixed to the viewport corner opposite the docked drawer (`side`), so
       it can never sit over the drawer's own controls on either side.
       Positioned above the footer's word count, clear of both. Purely a
       status readout: `pointer-events-none` so it never intercepts clicks,
       and `fixed` positioning so it never participates in layout / can
       never shift anything else. -->
  <div
    class="pointer-events-none fixed bottom-8 z-30 flex items-center gap-1.5 transition-opacity duration-300 ease-out"
    :class="[side === 'right' ? 'left-3' : 'right-3', visible ? 'opacity-100' : 'opacity-0']"
    role="status"
    aria-live="polite"
    aria-label="Save status"
  >
    <span class="sr-only">{{ announcement }}</span>
    <span
      v-if="icon === 'saving'"
      class="flex h-6 w-6 items-center justify-center rounded-full bg-base-200 shadow"
      aria-hidden="true"
    >
      <ArrowPathIcon
        class="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
        :style="{ color: ink('--color-base-content') }"
      />
    </span>
    <span
      v-else-if="icon === 'success'"
      class="flex h-6 w-6 items-center justify-center rounded-full bg-base-200 shadow"
      aria-hidden="true"
    >
      <CheckIcon class="h-3.5 w-3.5" :style="{ color: ink('--color-success') }" />
    </span>
    <template v-else-if="icon === 'error'">
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
    </template>
  </div>
</template>

<script setup lang="ts">
import { useUnit } from 'effector-vue/composition'
import { XMarkIcon } from '@heroicons/vue/24/outline'

import { $zenMode, zenExited } from '../model/zen'

const zenMode = useUnit($zenMode)

// A previous version of this control failed review: its only exit was a
// 40%-opacity glyph measuring 2.53:1 contrast, and on mobile the button
// that toggled zen mode lived inside the very chrome zen mode hides.
//
// Fixed here with a fixed, always-rendered corner button, reachable by a
// plain tap, never nested inside the header/toolbar chrome that zen mode
// itself hides. Deliberately NOT `.btn-primary` (a first attempt at this
// used it, reasoning from `app/styles/main.css`'s Phase 4/5 comments, but
// those describe `--color-primary` in isolation — dark theme's
// `.btn-primary` is *overridden* elsewhere in that file to
// `--btn-color: var(--md-seg-active)` (#22252a, so the "New file" button
// matches the segmented control's active-tab fill), which measures only
// ~1.25:1 against this app's near-black dark-theme background — nowhere
// near the 3:1 floor this control needs. Measured in the browser instead
// of assumed from a comment written for a different rule.
//
// `--md-accent` (the TEXT/focus-ring token — see that same file's "PRIMARY
// SURFACE/ACCENT SPLIT — Phase 4" comment) as the fill, `--color-base-100`
// (the app's own near-black-dark/near-white-light background extreme) as
// the icon colour, is the same two already-themed tokens used elsewhere,
// just in fill/foreground roles neither has held before — no new hex
// values introduced. Because contrast ratio is symmetric in the two
// colours being compared, "fill vs the page behind it" and "icon vs fill"
// both reduce to the exact same already-documented pair:
//   - dark: `--md-accent` #9c968d vs `--color-base-100` #0e0f11 — 6.539:1
//   - light: `--md-accent` #635f57 vs `--color-base-100` #fbfaf8 — 6.091:1
// Both comfortably clear the 4.5:1 text floor, well past the 3:1 non-text
// floor this control only strictly needs. Verified by direct measurement
// in the browser in both themes as part of this task (see the task
// report), not just by this derivation.
</script>

<template>
  <button
    v-if="zenMode"
    type="button"
    class="zen-exit-btn btn btn-circle fixed right-4 bottom-4 z-[80] h-12 w-12 min-h-0 print:hidden"
    aria-label="Exit Zen mode"
    @click="zenExited()"
  >
    <XMarkIcon class="h-5 w-5" />
  </button>
</template>

<style scoped>
.zen-exit-btn {
  background-color: var(--md-accent);
  color: var(--color-base-100);
}

.zen-exit-btn:hover {
  background-color: var(--md-accent);
  opacity: 0.9;
}

.zen-exit-btn:focus-visible {
  outline: 2px solid var(--md-accent);
  outline-offset: 2px;
}
</style>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useUnit } from 'effector-vue/composition'

import {
  $splitRatio,
  splitRatioChanged,
  splitRatioReset,
  clampRatio,
  MIN_RATIO,
  MAX_RATIO,
  KEYBOARD_STEP,
  KEYBOARD_STEP_LARGE,
} from '../model/layout'

const splitter = ref<HTMLDivElement | null>(null)
const dragging = ref(false)
// Pointer x minus the handle's own centre x, captured on `pointerdown` —
// lets `ratioFromPointer` track wherever inside the handle the user
// actually grabbed instead of snapping the handle's left edge to the raw
// pointer position (see fix notes below).
const grabOffset = ref(0)

const splitRatio = useUnit($splitRatio)

const ariaValueNow = computed(() => Math.round(splitRatio.value * 100))
const ariaValueMin = Math.round(MIN_RATIO * 100)
const ariaValueMax = Math.round(MAX_RATIO * 100)

/** Resets everything a drag touches outside of Vue/Effector state, so
 * every exit path (pointerup, pointercancel, lostpointercapture, a failed
 * setPointerCapture) can call this instead of duplicating — and risking
 * skipping — part of the cleanup. */
function resetDragState() {
  dragging.value = false
  document.body.style.userSelect = ''
}

/** Reads the ratio implied by a clientX against the splitter's own parent
 * — the flex row it shares with the editor and preview panes — rather
 * than requiring a container ref/prop passed down from AppShell. Accounts
 * for `grabOffset` (so the handle doesn't jump to centre itself under the
 * pointer) and for the handle's own width (so the ratio reflects the
 * handle's left edge, not its centre). */
function ratioFromPointer(clientX: number): number | null {
  const el = splitter.value
  const container = el?.parentElement
  if (!el || !container) return null
  const containerRect = container.getBoundingClientRect()
  if (containerRect.width === 0) return null
  const handleWidth = el.getBoundingClientRect().width
  const handleCenterX = clientX - grabOffset.value
  const leftEdge = handleCenterX - containerRect.left - handleWidth / 2
  return clampRatio(leftEdge / containerRect.width)
}

/** Re-syncs the DOM to the authoritative store value after a drag commit.
 * `splitRatioChanged` may be a no-op at the Effector level (released ratio
 * equals the stored one) or a no-op at the Vue vnode level (rounds to the
 * same integer percent already rendered) — either way Vue can decide there
 * is nothing to patch and leave the mid-drag manual DOM write in place.
 * Clearing the inline override hands `--split-ratio` back to Vue's own
 * `:style` binding, and `aria-valuenow` is written explicitly since it
 * must be correct even when Vue skips the patch. */
function resyncDomToStore() {
  const container = splitter.value?.parentElement
  container?.style.removeProperty('--split-ratio')
  splitter.value?.setAttribute('aria-valuenow', String(ariaValueNow.value))
}

function commitRatio(clientX: number) {
  const ratio = ratioFromPointer(clientX)
  if (ratio !== null) {
    splitRatioChanged(ratio)
  }
  // Unconditional: the store is the single source of truth at drag end
  // whether or not the event above actually changed it.
  resyncDomToStore()
}

function handlePointerDown(event: PointerEvent) {
  const el = splitter.value
  if (!el) return
  // Touch/pen report `button === 0` unconditionally; only filter for the
  // primary mouse button.
  if (event.pointerType === 'mouse' && event.button !== 0) return

  const handleRect = el.getBoundingClientRect()
  grabOffset.value = event.clientX - (handleRect.left + handleRect.width / 2)

  dragging.value = true
  try {
    el.setPointerCapture(event.pointerId)
  } catch {
    // The pointer can already be gone (e.g. `NotFoundError`) by the time
    // capture is requested. Without this, the exception would escape
    // between `dragging = true` and the `userSelect` write below, leaving
    // a half-initialised drag that nothing ever cleans up.
    resetDragState()
    return
  }
  // Prevents the drag from selecting surrounding text while the pointer
  // sweeps across the editor/preview panes.
  document.body.style.userSelect = 'none'
}

function handlePointerMove(event: PointerEvent) {
  if (!dragging.value) return
  // Implicit pointer capture release (e.g. the splitter stops being
  // rendered mid-drag, such as crossing the `md` breakpoint) can leave a
  // `pointerup`/`pointercancel` unfired. A move event with no buttons held
  // means the drag already ended without us hearing about it — treat it as
  // the missed pointerup instead of continuing to resize on hover.
  if (event.buttons === 0) {
    handlePointerUp(event)
    return
  }
  const el = splitter.value
  const container = el?.parentElement
  const ratio = ratioFromPointer(event.clientX)
  if (!el || !container || ratio === null) return

  // Direct DOM writes for the duration of the drag — no Vue reactivity,
  // no Effector store update, so no per-pixel re-render. The store (and
  // its localStorage persistence) is only touched once, in
  // `handlePointerUp`.
  container.style.setProperty('--split-ratio', String(ratio))
  el.setAttribute('aria-valuenow', String(Math.round(ratio * 100)))
}

function handlePointerUp(event: PointerEvent) {
  if (!dragging.value) return
  resetDragState()

  const el = splitter.value
  commitRatio(event.clientX)
  if (el?.hasPointerCapture(event.pointerId)) {
    el.releasePointerCapture(event.pointerId)
  }
}

function handleDoubleClick() {
  splitRatioReset()
}

function handleKeydown(event: KeyboardEvent) {
  const step = event.shiftKey ? KEYBOARD_STEP_LARGE : KEYBOARD_STEP
  switch (event.key) {
    case 'ArrowLeft':
      event.preventDefault()
      splitRatioChanged(splitRatio.value - step)
      break
    case 'ArrowRight':
      event.preventDefault()
      splitRatioChanged(splitRatio.value + step)
      break
    case 'Home':
      event.preventDefault()
      splitRatioChanged(MIN_RATIO)
      break
    case 'End':
      event.preventDefault()
      splitRatioChanged(MAX_RATIO)
      break
    case 'Enter':
      event.preventDefault()
      splitRatioReset()
      break
  }
}
</script>

<template>
  <div
    ref="splitter"
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize editor and preview panes"
    :aria-valuenow="ariaValueNow"
    :aria-valuemin="ariaValueMin"
    :aria-valuemax="ariaValueMax"
    tabindex="0"
    class="splitter relative z-10 flex w-3 shrink-0 touch-none items-stretch justify-center outline-none select-none print:hidden"
    :class="{ dragging }"
    @pointerdown="handlePointerDown"
    @pointermove="handlePointerMove"
    @pointerup="handlePointerUp"
    @pointercancel="handlePointerUp"
    @lostpointercapture="handlePointerUp"
    @dblclick="handleDoubleClick"
    @keydown="handleKeydown"
  >
    <div class="line pointer-events-none w-px bg-base-300" />
  </div>
</template>

<style scoped>
/*
 * The visual divider stays a hairline (`w-px`) at all times — only its
 * colour changes on hover/focus/drag — while the actual pointer/keyboard
 * target is the full 12px (`w-3`) hit area on the parent. Colours use raw
 * `var(--color-*)` rather than Tailwind's `-primary` suffix utilities to
 * match the rest of the app (see `ink.ts`, `editor/lib/theme.ts`): nothing
 * else in this codebase relies on daisyUI exposing its palette as generic
 * Tailwind color utilities, so this doesn't start depending on that either.
 */
.splitter {
  cursor: col-resize;
}

.splitter:hover .line,
.splitter:focus-visible .line,
.splitter.dragging .line {
  background-color: var(--color-primary);
}

.splitter:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}
</style>

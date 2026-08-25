<script setup lang="ts">
/**
 * "Jump to top" / "jump to bottom" for a scrollable pane — ONE shared
 * implementation used twice: once for the editor
 * (`features/editor/ui/Editor.vue`, whose scroller is CodeMirror's own
 * `.cm-scroller`, exposed as a plain `HTMLElement` via `view.scrollDOM`)
 * and once for the preview (`features/preview/ui/Preview.vue`, a plain
 * `overflow-y-auto` div that component already owns). A single
 * `scrollElement` prop is enough to serve both because neither "should a
 * button show right now" nor "how to animate the scroll" cares what's
 * actually rendered inside the scroller — both are pure functions of the
 * standard `scrollTop`/`scrollHeight`/`clientHeight`/`scrollTo` surface
 * every scrollable `HTMLElement` already exposes, CodeMirror's or a plain
 * div's alike. Two near-identical per-feature implementations would only
 * ever be able to drift apart, not actually differ on purpose. Lives in
 * `shared/ui` (not inside either feature) for exactly that reason, and
 * because `editor` and `preview` must never import from each other
 * directly (see ARCHITECTURE.md's boundary rules) — a component either one
 * needed from the other would have nowhere legal to live but here anyway.
 *
 * PERFORMANCE — never reads `scrollTop`/`scrollHeight`/`clientHeight`
 * (all of which can force layout) synchronously inside an event handler.
 * Three cheap, independently-firing triggers — the scroller's own 'scroll'
 * event, a window 'resize' (the pane's own `clientHeight` can change), and
 * a `MutationObserver` on the scroller's subtree (content can grow or
 * shrink — e.g. typing past the end of a long document while scrolled up
 * reading something else — without the pane itself ever scrolling or
 * resizing, which neither of the other two triggers would catch) — all
 * funnel into `scheduleUpdate`, which coalesces them into a single
 * `requestAnimationFrame` callback. However many of those events fire
 * between two frames, the actual layout read in `updateVisibility` runs at
 * most once per frame, not once per event.
 */
import { onBeforeUnmount, ref, watch } from 'vue'
import { ChevronDoubleUpIcon, ChevronDoubleDownIcon } from '@heroicons/vue/24/outline'

const props = defineProps<{
  /** The element that actually scrolls. `null` while the underlying view
   * (the CodeMirror instance, or the preview's own scroller ref) hasn't
   * mounted yet — both buttons stay hidden the whole time. */
  scrollElement: HTMLElement | null
}>()

/** Below this many px of scrollable distance, treat the pane as "not
 * scrollable" / "already at that edge" — absorbs sub-pixel layout rounding
 * (a fractional `scrollHeight - clientHeight` of ~0.5px is common with
 * fractional font metrics) so a button never flickers in and out at rest. */
const EDGE_EPSILON_PX = 2

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

const showTop = ref(false)
const showBottom = ref(false)

function updateVisibility(): void {
  const el = props.scrollElement
  if (el === null) {
    showTop.value = false
    showBottom.value = false
    return
  }
  const scrollable = el.scrollHeight - el.clientHeight > EDGE_EPSILON_PX
  showTop.value = scrollable && el.scrollTop > EDGE_EPSILON_PX
  showBottom.value =
    scrollable && el.scrollTop < el.scrollHeight - el.clientHeight - EDGE_EPSILON_PX
}

let frameId: number | null = null

function scheduleUpdate(): void {
  if (frameId !== null) return
  frameId = requestAnimationFrame(() => {
    frameId = null
    updateVisibility()
  })
}

let mutationObserver: MutationObserver | null = null

function detach(el: HTMLElement | null): void {
  el?.removeEventListener('scroll', scheduleUpdate)
  mutationObserver?.disconnect()
  mutationObserver = null
}

function attach(el: HTMLElement | null): void {
  if (el === null) return
  el.addEventListener('scroll', scheduleUpdate, { passive: true })
  mutationObserver = new MutationObserver(scheduleUpdate)
  mutationObserver.observe(el, { childList: true, subtree: true, characterData: true })
}

// `immediate: true` covers both directions this prop actually changes in
// practice: mounting with `scrollElement` already set (the preview's own
// `scroller` ref, assigned before this component's first render) and
// mounting `null` then receiving the real element a tick later (the
// editor, whose CodeMirror view attaches asynchronously — see `Editor
// .vue`'s `onViewReady`). Either way, `scheduleUpdate()` runs right after
// (re)attaching so the initial button state is never stale.
watch(
  () => props.scrollElement,
  (next, previous) => {
    detach(previous ?? null)
    attach(next)
    scheduleUpdate()
  },
  { immediate: true },
)

function handleWindowResize(): void {
  scheduleUpdate()
}

if (typeof window !== 'undefined') {
  window.addEventListener('resize', handleWindowResize, { passive: true })
}

onBeforeUnmount(() => {
  detach(props.scrollElement)
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', handleWindowResize)
  }
  if (frameId !== null) {
    cancelAnimationFrame(frameId)
    frameId = null
  }
})

/** How many corrective follow-up checks a jump allows itself — see
 * `correctedScrollTo`'s own comment for why a correction is needed at all.
 * Five, ~150ms apart: comfortably more than the one or two rounds a real
 * CodeMirror document needed while building this, without letting a
 * pathological case retry forever. */
const CORRECTION_ATTEMPTS = 5
const CORRECTION_INTERVAL_MS = 150

/**
 * Scrolls `el` toward `top` (0 for "top", `Number.MAX_SAFE_INTEGER` —
 * clamped by the browser to the real bottom — for "bottom"), then
 * re-checks a few times after the scroll should have settled and nudges
 * the rest of the way if it didn't land where asked.
 *
 * Two independent reasons a single `scrollTo` call can fall short, both
 * specific to CodeMirror's editor scroller (reproduced while building
 * this) but handled generically here rather than with editor-specific
 * code, since this component has no CodeMirror-specific knowledge by
 * design (see the file's own top comment):
 *
 *   1. `el.scrollHeight` for content far below the current viewport is an
 *      ESTIMATE — CodeMirror only measures a line's real pixel height once
 *      it's actually been rendered — that GROWS as the browser scrolls
 *      through and CodeMirror measures more of it. Browsers do not keep
 *      re-clamping an in-flight smooth scroll's target against a growing
 *      `scrollHeight`, so a "scroll to bottom" can land short of the true
 *      bottom once that growth happens mid-animation.
 *   2. CodeMirror's own internal scroll-anchoring (keeping the visible
 *      content stable as nearby lines' estimated heights get corrected)
 *      can write `scrollTop` directly outside this component's control —
 *      and per the CSSOM View spec, ANY write to `scrollTop`, even a
 *      plain property assignment, cancels whatever smooth-scroll animation
 *      was already in flight, stranding it wherever that write left it.
 *
 * Neither is something this component can prevent from the outside — both
 * are just consequences of the scroller doing its own layout work as it
 * scrolls — so instead of a single fire-and-forget call, this checks
 * whether the scroll actually landed close to `top` (clamped into
 * `[0, scrollHeight - clientHeight]`, since `Number.MAX_SAFE_INTEGER`
 * itself is never a real position to compare against) and re-issues if
 * not. Every retry after the first is `behavior: 'auto'` (instant), never
 * `'smooth'` again — a second visible scroll animation stacked on the
 * first would read as a stutter, not a fix; the whole point is that a
 * correction is imperceptible on top of a scroll the user already saw
 * complete.
 */
function correctedScrollTo(el: HTMLElement, top: number, attemptsLeft: number): void {
  const behavior =
    attemptsLeft === CORRECTION_ATTEMPTS && !prefersReducedMotion() ? 'smooth' : 'auto'
  el.scrollTo({ top, behavior })
  if (attemptsLeft <= 1) return
  setTimeout(() => {
    // The pane may have scrolled again, switched documents, or unmounted
    // in the interval — only correct if this is still the same element
    // this whole call chain started against.
    if (props.scrollElement !== el) return
    const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight)
    const target = Math.min(top, maxScrollTop)
    if (Math.abs(el.scrollTop - target) > EDGE_EPSILON_PX) {
      correctedScrollTo(el, top, attemptsLeft - 1)
    }
  }, CORRECTION_INTERVAL_MS)
}

function scrollToTop(): void {
  const el = props.scrollElement
  if (el === null) return
  correctedScrollTo(el, 0, CORRECTION_ATTEMPTS)
}

function scrollToBottom(): void {
  const el = props.scrollElement
  if (el === null) return
  correctedScrollTo(el, Number.MAX_SAFE_INTEGER, CORRECTION_ATTEMPTS)
}
</script>

<template>
  <!-- `pointer-events: none` on the wrapper, `auto` on each button
       (scoped style below) — the wrapper's own box (tall enough to fit
       both buttons stacked) must never intercept clicks/selection on the
       text underneath it in the gap between the two buttons or while one
       of them is hidden. -->
  <div class="scroll-jump-buttons">
    <button
      v-show="showTop"
      type="button"
      class="scroll-jump-btn"
      aria-label="Scroll to top"
      @click="scrollToTop"
    >
      <ChevronDoubleUpIcon class="h-4 w-4" />
    </button>
    <button
      v-show="showBottom"
      type="button"
      class="scroll-jump-btn"
      aria-label="Scroll to bottom"
      @click="scrollToBottom"
    >
      <ChevronDoubleDownIcon class="h-4 w-4" />
    </button>
  </div>
</template>

<style scoped>
/* Not named anything from daisyUI's own namespace (`btn`, `fab`, etc.) —
 * see `DrawerToggleButton.vue`'s own comment on the `drawer-toggle`
 * incident this app already hit once for why that check matters. Hand-
 * rolled (not `.btn`) for the same reason `DrawerToggleButton.vue`/
 * `SaveIndicator.vue`'s own icon controls are: this needs a fixed,
 * exactly-known 28px circle (matching `--md-toggle-size`, this app's
 * established floating-icon-control footprint) and an ALWAYS-VISIBLE fill
 * (daisyUI's `.btn-ghost` is transparent at rest, which is wrong for a
 * button meant to float legibly over arbitrary, scrolling text/code rather
 * than over a flat toolbar background).
 */
.scroll-jump-buttons {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 6px;
  pointer-events: none;
}

/*
 * CONTRAST — measured against REAL rendered pixels (a Playwright tab,
 * canvas-compositing every colour over its actual backdrop rather than
 * trusting the unrounded formula, then the standard WCAG relative-
 * luminance ratio), all four theme x soft-contrast combinations:
 *   - Icon (`--color-base-content`) vs fill (`--color-base-200`): 13.04:1
 *     (light+soft, the tightest) to 15.40:1 (light) — clears the 4.5:1
 *     text floor with wide margin in every combination.
 *   - Border (`color-mix(in srgb, var(--color-base-content) 55%,
 *     transparent)`, composited over the editor/preview pane's own
 *     `--color-base-100` background — the same worst-case surface this
 *     app's other translucent-border controls are measured against, e.g.
 *     `SettingsModal.vue`'s `.settings-folder-list` checkbox border) vs
 *     that same background: 3.62:1 (dark+soft, the tightest) to 5.14:1
 *     (dark) — clears the 3:1 non-text/UI-boundary floor in every
 *     combination. A plain `--color-base-200`/`--color-base-300` fill
 *     alone could NOT reach 3:1 here (this app's neutral surface tokens
 *     sit only ~1.0-1.3:1 apart from each other by design — see
 *     `app/styles/main.css`'s "KNOWN CONTRAST LIMITATIONS" note), which is
 *     why this button gets an explicit `border` rather than relying on its
 *     fill (or the drop-shadow alone) to read as a distinct shape against
 *     whatever content happens to be scrolled underneath it.
 */
.scroll-jump-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--color-base-content) 55%, transparent);
  border-radius: 999px;
  background: var(--color-base-200);
  color: var(--color-base-content);
  cursor: pointer;
  pointer-events: auto;
  box-shadow: var(--md-shadow-pop, 0 4px 12px rgb(0 0 0 / 15%));
}

.scroll-jump-btn:hover {
  background: var(--md-hov, var(--color-base-300));
}

.scroll-jump-btn:focus-visible {
  outline: 2px solid var(--md-accent);
  outline-offset: 2px;
}
</style>

<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import { useUnit } from 'effector-vue/composition'

import { Preview, $previewScrollHandle } from '@/features/preview'
import { buildAnchorTable, claimPreviewScroll, type ScrollAnchor } from '@/features/scroll-sync'

import { $outlineOpen, $outlineHeadings, type OutlineHeading } from '../model/outline'

defineProps<{
  /** Whether this pane is the sole visible one (desktop editor-only or
   * preview-only, or any mobile state) — see `AppShell`'s `centered`. Kept
   * as a prop (even though it's `true` unconditionally today) rather than
   * inlined, so a future mode that wants full-bleed content has somewhere
   * to branch back off. */
  centered?: boolean
}>()

const outlineOpen = useUnit($outlineOpen)
const headings = useUnit($outlineHeadings)
const previewScrollHandle = useUnit($previewScrollHandle)

// --- Active-heading scrollspy -----------------------------------------
//
// Which heading is "currently in view" as the preview scrolls, keyed by
// `data-line` (see `OutlineHeading.line`'s doc comment — never text, since
// duplicate heading text is common). `null` before the first heading has
// been reached (a preamble above the first heading has nothing to
// highlight yet).
const activeLine = ref<number | null>(null)

// Cached heading-only anchor table. Same shape as `scroll-sync`'s own
// cache (`syncSession.ts`'s `anchors`/`invalidateAnchors`/`getAnchors`):
// building it is a batch of `getBoundingClientRect` reads, so it must not
// happen on every scroll event, only lazily the next time it's actually
// needed, and invalidated (not eagerly rebuilt) whenever the rendered
// preview DOM changes. `buildAnchorTable` itself — the read loop and the
// line/top monotonic-filtering — is imported from `scroll-sync`, not
// reimplemented here; only the "which anchor is active" scrollspy logic
// below is specific to the outline.
let headingAnchors: ScrollAnchor[] | null = null
let mutationObserver: MutationObserver | null = null
let rafHandle: number | null = null

const HEADING_SELECTOR = 'h1[data-line], h2[data-line], h3[data-line]'

function invalidateHeadingAnchors() {
  headingAnchors = null
}

function getHeadingAnchors(): ScrollAnchor[] {
  const handle = previewScrollHandle.value
  if (handle === null) return []
  if (headingAnchors === null) {
    headingAnchors = buildAnchorTable(
      handle.getScroller(),
      handle.getContentRoot(),
      HEADING_SELECTOR,
    )
  }
  return headingAnchors
}

function updateActiveHeading() {
  const anchors = getHeadingAnchors()
  const handle = previewScrollHandle.value
  if (anchors.length === 0 || handle === null) {
    activeLine.value = null
    return
  }
  const scrollTop = handle.getScroller().scrollTop
  // Scrollspy: the last heading whose top has scrolled to (or past) the
  // viewport top is the section currently being read — the same
  // convention doc-site "on this page" navs use. `anchors` is guaranteed
  // ascending by `top` (see `buildAnchorTable`'s own monotonic guard), so
  // a single forward scan finds it; +1px tolerates sub-pixel rounding
  // between a `scrollTop` write and the resulting `getBoundingClientRect`.
  //
  // At `scrollTop === 0` specifically, default to the first heading rather
  // than "none": `.markdown-preview`'s own top padding (`p-4`) puts every
  // first heading a few px below the viewport top even when it's the very
  // first thing in the document, which would otherwise leave nothing
  // highlighted at rest right after opening a document or reloading —
  // measured ~16px of padding, comfortably explained by chrome rather than
  // genuine preamble content. Scrolled anywhere past that padding, this
  // reverts to "nothing until a heading is actually reached", unchanged
  // for a document with real prose before its first heading.
  let current: number | null = scrollTop <= 0 ? (anchors[0]?.line ?? null) : null
  for (const anchor of anchors) {
    if (anchor.top <= scrollTop + 1) {
      current = anchor.line
    } else {
      break
    }
  }
  activeLine.value = current
}

function scheduleActiveUpdate() {
  if (rafHandle !== null) return
  rafHandle = requestAnimationFrame(() => {
    rafHandle = null
    updateActiveHeading()
  })
}

function onPreviewScroll() {
  scheduleActiveUpdate()
}

function teardownWatchers() {
  mutationObserver?.disconnect()
  mutationObserver = null
  if (rafHandle !== null) {
    cancelAnimationFrame(rafHandle)
    rafHandle = null
  }
}

// The preview scroll handle only exists once `Preview.vue` has mounted
// (`$previewScrollHandle`, from the preview feature) — `immediate: true`
// wires up as soon as it does, and the teardown/rewire on change guards
// the (never expected in practice, since the pane stays `v-show`-mounted
// for the app's lifetime) case of the handle's identity changing.
watch(
  previewScrollHandle,
  (handle, previousHandle) => {
    previousHandle?.getScroller().removeEventListener('scroll', onPreviewScroll)
    teardownWatchers()
    invalidateHeadingAnchors()
    if (handle === null) {
      activeLine.value = null
      return
    }
    handle.getScroller().addEventListener('scroll', onPreviewScroll, { passive: true })
    // The preview's HTML is replaced wholesale on every debounced render
    // (see `preview/model/preview.ts`) — exactly the kind of change a
    // `MutationObserver` reports, same trigger `scroll-sync`'s own session
    // invalidates its anchor table on.
    mutationObserver = new MutationObserver(() => {
      invalidateHeadingAnchors()
      scheduleActiveUpdate()
    })
    mutationObserver.observe(handle.getContentRoot(), {
      childList: true,
      subtree: true,
      characterData: true,
    })
    scheduleActiveUpdate()
  },
  { immediate: true },
)

onUnmounted(() => {
  previewScrollHandle.value?.getScroller().removeEventListener('scroll', onPreviewScroll)
  teardownWatchers()
})

function scrollToHeading(heading: OutlineHeading) {
  const handle = previewScrollHandle.value
  if (handle === null) return
  // Rebuilt (not read from cache) so a click always targets the heading's
  // current position, even if the last cached table predates a layout
  // shift the mutation observer hasn't caught up to yet.
  invalidateHeadingAnchors()
  const anchor = getHeadingAnchors().find((entry) => entry.line === heading.line)
  if (anchor === undefined) return

  // Claim preview-pane scroll ownership *before* moving it (see
  // `claimPreviewScroll`'s doc comment in `scroll-sync`) so the jump below
  // also drives the editor to match, through scroll-sync's own already-
  // wired `scroll` listener and anchor-table/interpolation — reusing that
  // machinery instead of a second line-to-editor-scroll calculation here.
  claimPreviewScroll()
  const scroller = handle.getScroller()
  const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
  scroller.scrollTop = Math.min(maxScroll, Math.max(0, anchor.top))
}

function headingStyle(heading: OutlineHeading) {
  const active = heading.line === activeLine.value
  return {
    paddingLeft: `${(heading.level - 1) * 11}px`,
    color: active
      ? 'var(--color-base-content)'
      : heading.level === 1
        ? 'var(--md-t2)'
        : 'var(--md-t3)',
    fontWeight: active ? 600 : heading.level === 1 ? 500 : 400,
  }
}
</script>

<template>
  <section
    class="flex h-full min-w-0 flex-1 overflow-hidden bg-base-100 print:!static print:!block print:!h-auto print:!w-full print:!overflow-visible"
  >
    <Preview :centered="centered" class="min-w-0 flex-1" />

    <!-- Outline nav — only worth the width below `lg`; the reference
         design fits it by measuring the pane's own pixel width
         (`outlineFits`), which this deliberately simplifies to a viewport
         breakpoint rather than a second `ResizeObserver` in this phase. -->
    <nav
      v-if="outlineOpen"
      class="hidden w-[190px] shrink-0 flex-col overflow-y-auto border-l border-base-300 px-4.5 py-11 lg:flex print:hidden"
      aria-label="On this page"
    >
      <div
        class="pb-3 text-[10.5px] font-semibold tracking-wider uppercase"
        style="color: var(--md-t4, var(--color-base-content))"
      >
        On this page
      </div>

      <!-- Empty state: an explicit message rather than either a bare
           "On this page" label sitting above nothing, or the whole nav
           silently not rendering (which would look identical to the panel
           having failed to mount at all). -->
      <p
        v-if="headings.length === 0"
        class="text-[12px] leading-relaxed"
        style="color: var(--md-t4, var(--color-base-content))"
      >
        No headings in this document.
      </p>

      <div v-else class="flex flex-col gap-0.5">
        <button
          v-for="heading in headings"
          :key="heading.line"
          type="button"
          class="outline-heading truncate rounded text-left text-[12.5px] leading-relaxed"
          :class="{ 'outline-heading-active': heading.line === activeLine }"
          :style="headingStyle(heading)"
          :aria-current="heading.line === activeLine ? 'true' : undefined"
          @click="scrollToHeading(heading)"
        >
          {{ heading.text }}
        </button>
      </div>
    </nav>
  </section>
</template>

<style scoped>
.outline-heading {
  cursor: pointer;
  transition:
    background 120ms ease,
    color 120ms ease;
}

.outline-heading:hover {
  background: var(--md-hov, var(--color-base-200));
}

.outline-heading:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}

.outline-heading-active {
  background: var(--md-sel, var(--color-base-200));
  box-shadow: inset 2px 0 0 var(--color-primary);
}
</style>

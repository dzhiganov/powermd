<script setup lang="ts">
import { ref } from 'vue'
import { useUnit } from 'effector-vue/composition'

import { Preview } from '@/features/preview'

import { $outlineOpen, $outlineHeadings } from '../model/outline'

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

// The outline nav (new in this phase — see `model/outline.ts`) is a purely
// presentational read of `.markdown-preview`'s own rendered headings,
// scoped to this component's own subtree rather than plumbed through a
// scroll-handle store: it only ever needs to count/scroll *this* pane's
// heading elements, in document order, which is exactly what querying its
// own DOM gives for free. `$outlineHeadings` (parsed straight from the
// markdown source, not the rendered DOM) supplies the *list* — its order
// matches the rendered `h1`-`h3` order 1:1 for any document without a
// heading-shaped line inside a fenced code block (see that store's doc
// comment), which is what makes indexing into both by position safe here.
const sectionRef = ref<HTMLElement | null>(null)

function scrollToHeading(index: number) {
  const root = sectionRef.value?.querySelector('.markdown-preview')
  const target = root?.querySelectorAll('h1, h2, h3')[index]
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <section
    ref="sectionRef"
    class="flex h-full min-w-0 flex-1 overflow-hidden bg-base-100 print:!static print:!block print:!h-auto print:!w-full print:!overflow-visible"
  >
    <Preview :centered="centered" class="min-w-0 flex-1" />

    <!-- Outline nav — only worth the width below `lg`; the reference
         design fits it by measuring the pane's own pixel width
         (`outlineFits`), which this deliberately simplifies to a viewport
         breakpoint rather than a second `ResizeObserver` in this phase. -->
    <nav
      v-if="outlineOpen && headings.length > 0"
      class="hidden w-[190px] shrink-0 flex-col overflow-y-auto border-l border-base-300 px-4.5 py-11 lg:flex print:hidden"
      aria-label="On this page"
    >
      <div
        class="pb-3 text-[10.5px] font-semibold tracking-wider uppercase"
        style="color: var(--md-t4, var(--color-base-content))"
      >
        On this page
      </div>
      <div class="flex flex-col gap-0.5">
        <button
          v-for="(heading, index) in headings"
          :key="index"
          type="button"
          class="truncate rounded text-left text-[12.5px] leading-relaxed"
          :style="{
            paddingLeft: `${(heading.level - 1) * 11}px`,
            color: heading.level === 1 ? 'var(--md-t2)' : 'var(--md-t3)',
            fontWeight: heading.level === 1 ? 500 : 400,
          }"
          @click="scrollToHeading(index)"
        >
          {{ heading.text }}
        </button>
      </div>
    </nav>
  </section>
</template>

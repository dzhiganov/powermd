<script setup lang="ts">
import { useUnit } from 'effector-vue/composition'

import { $headings, $activeHeadingLine, headingClicked } from '../model/outline'

// Which side this panel sits on — purely presentational (border side); the
// actual "mirror the documents panel's side" rule lives in
// `layout/ui/AppShell.vue`, the one place that knows both this panel and
// the documents drawer exist.
withDefaults(defineProps<{ side?: 'left' | 'right' }>(), { side: 'right' })

const headings = useUnit($headings)
const activeLine = useUnit($activeHeadingLine)

function selectHeading(line: number): void {
  headingClicked(line)
}
</script>

<template>
  <aside
    class="flex h-full w-56 shrink-0 flex-col overflow-hidden border-base-300 print:hidden"
    :class="side === 'right' ? 'order-3 border-l' : 'order-1 border-r'"
    style="background: var(--md-rail, var(--color-base-200))"
    aria-label="Document outline"
  >
    <div class="shrink-0 border-b border-base-300 px-3 py-2.5">
      <h2
        class="text-xs font-semibold tracking-wide uppercase"
        style="color: var(--md-t4, var(--color-base-content))"
      >
        Outline
      </h2>
    </div>

    <!-- Empty state — no bare panel when the document has no headings. -->
    <p
      v-if="headings.length === 0"
      class="flex flex-1 items-center justify-center px-4 py-8 text-center text-xs"
      style="color: var(--md-t4, var(--color-base-content))"
    >
      This document has no headings yet.
    </p>

    <nav v-else class="min-h-0 flex-1 overflow-y-auto p-2" aria-label="Headings">
      <ul class="flex flex-col gap-0.5">
        <li v-for="heading in headings" :key="heading.line">
          <button
            type="button"
            class="outline-item"
            :class="{ 'outline-item-active': heading.line === activeLine }"
            :style="{ paddingInlineStart: `${8 + (heading.level - 1) * 12}px` }"
            :aria-current="heading.line === activeLine ? 'true' : undefined"
            @click="selectHeading(heading.line)"
          >
            {{ heading.text || 'Untitled heading' }}
          </button>
        </li>
      </ul>
    </nav>
  </aside>
</template>

<style scoped>
/* Matches the muted/active text-colour convention already used for small
 * list-style controls in this app (`Toolbar.vue`'s `.view-tab`,
 * `DocumentDrawer.vue`'s `.dock-btn`) — `--md-seg-fg` and full
 * `--color-base-content` are both already measured >=4.5:1 in both themes
 * (see `app/styles/main.css`'s `--md-seg-fg` comment), so no new contrast
 * value is introduced here. */
.outline-item {
  display: block;
  width: 100%;
  overflow: hidden;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--md-seg-fg, var(--color-base-content));
  cursor: pointer;
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding-block: 6px;
  padding-inline-end: 10px;
}

.outline-item:hover {
  background: var(--md-hov, var(--color-base-300));
}

.outline-item-active {
  background: var(--md-sel, var(--color-base-300));
  color: var(--color-base-content);
  font-weight: 600;
}

.outline-item:focus-visible {
  outline: 2px solid var(--md-accent);
  outline-offset: -2px;
}
</style>

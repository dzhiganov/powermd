<script setup lang="ts">
/**
 * The floating toolbar over a selection: four colours, and a note field.
 *
 * Two jobs in one surface, matching the reference design. Clicking a colour
 * creates the highlight immediately — the common case, one click. The note
 * button opens a field, and Cmd/Ctrl+Enter creates the highlight WITH the
 * note in the same step rather than making you create it first and annotate
 * it after.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useUnit } from 'effector-vue/composition'
import { Bars3BottomLeftIcon } from '@heroicons/vue/24/outline'

import { DEFAULT_HIGHLIGHT_COLOR, type HighlightColorId } from '@/shared/config/highlightColors'
import { isMac } from '@/shared/lib/platform'

import { $selection, highlightCreated, selectionDismissed } from '../model/highlights'
import ColorSwatches from './ColorSwatches.vue'

const selection = useUnit($selection)

const noteOpen = ref(false)
const note = ref('')
const noteRef = ref<HTMLTextAreaElement | null>(null)
/** Which colour a note-first creation will use. Set by picking a swatch
 * while the note field is open, so "note, then colour" and "colour, then
 * note" both work. */
const pendingColor = ref<HighlightColorId>(DEFAULT_HIGHLIGHT_COLOR)

/** Hidden when nothing is selected, and when the selection has scrolled out
 * of view (`rect === null`) — a toolbar pinned to where the text used to be
 * points at nothing. */
const visible = computed(() => selection.value !== null && selection.value.rect !== null)

// A fresh selection starts a fresh toolbar: an open note field left over
// from the last one would look like it belongs to this selection.
watch(
  () => selection.value?.from,
  () => {
    noteOpen.value = false
    note.value = ''
    pendingColor.value = DEFAULT_HIGHLIGHT_COLOR
  },
)

/** Centred over the selection and just above it. `position: fixed`, so the
 * viewport coordinates the editor measured are used as-is. Clamped to the
 * window so a selection near an edge doesn't push it off-screen. */
const style = computed(() => {
  const rect = selection.value?.rect
  if (!rect) return {}
  const width = noteOpen.value ? 320 : 190
  const centre = (rect.left + rect.right) / 2
  const left = Math.min(Math.max(centre - width / 2, 8), window.innerWidth - width - 8)
  // Above the selection normally; below it when there is no room above.
  const above = rect.top > 120
  return {
    left: `${left}px`,
    top: above ? `${rect.top - 12}px` : `${rect.bottom + 12}px`,
    transform: above ? 'translateY(-100%)' : undefined,
    width: `${width}px`,
  }
})

const noteHint = computed(() => (isMac() ? '⌘↵ to save' : 'Ctrl+↵ to save'))

function pick(color: HighlightColorId): void {
  if (noteOpen.value) {
    // Choosing a colour while writing a note sets the colour for that note
    // rather than creating a second, note-less highlight.
    pendingColor.value = color
    return
  }
  highlightCreated({ color, note: '' })
}

async function toggleNote(): Promise<void> {
  noteOpen.value = !noteOpen.value
  if (!noteOpen.value) return
  await nextTick()
  noteRef.value?.focus()
}

function commitNote(): void {
  highlightCreated({ color: pendingColor.value, note: note.value.trim() })
}
</script>

<template>
  <!-- `fixed`, not absolute: the coordinates come from the editor's own
       `coordsAtPos`, which are viewport-relative. Anchoring to a positioned
       ancestor would mean subtracting that ancestor's box back out, and
       getting it wrong every time the panes resize. -->
  <div
    v-if="visible"
    class="highlight-toolbar fixed z-[45] print:hidden"
    :style="style"
    role="dialog"
    aria-label="Highlight selection"
    @mousedown.prevent
  >
    <div class="flex items-center gap-2 p-2">
      <ColorSwatches :selected="noteOpen ? pendingColor : null" @pick="pick" />
      <div class="ml-auto flex items-center gap-1">
        <button
          type="button"
          class="toolbar-icon"
          :aria-label="noteOpen ? 'Hide note field' : 'Add a note'"
          :aria-expanded="noteOpen"
          @click="toggleNote"
        >
          <Bars3BottomLeftIcon class="h-4 w-4" />
        </button>
      </div>
    </div>

    <div v-if="noteOpen" class="px-2 pb-2">
      <textarea
        ref="noteRef"
        v-model="note"
        class="note-field"
        rows="2"
        :placeholder="`Add a note — ${noteHint}`"
        aria-label="Highlight note"
        @keydown.meta.enter.prevent="commitNote"
        @keydown.ctrl.enter.prevent="commitNote"
        @keydown.esc.prevent="selectionDismissed()"
      />
    </div>
  </div>
</template>

<style scoped>
/* Same popover surface as every menu in the app (`--md-pop` /
 * `--color-base-300` / `--md-shadow-pop`), so a floating control reads as
 * part of the same system wherever it appears. */
.highlight-toolbar {
  border: 1px solid var(--color-base-300);
  border-radius: 12px;
  background: var(--md-pop, var(--color-base-100));
  box-shadow: var(--md-shadow-pop, 0 12px 32px rgb(0 0 0 / 40%));
}

.toolbar-icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--color-base-content);
  cursor: pointer;
}

.toolbar-icon:hover {
  background: var(--md-hov, var(--color-base-200));
}

.toolbar-icon:focus-visible {
  outline: 2px solid var(--md-accent);
  outline-offset: -2px;
}

.note-field {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--color-base-300);
  border-radius: 8px;
  background: var(--color-base-100);
  color: var(--color-base-content);
  font: inherit;
  font-size: 13px;
  resize: none;
}

.note-field:focus-visible {
  outline: 2px solid var(--md-accent);
  outline-offset: -1px;
}
</style>

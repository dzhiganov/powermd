<script setup lang="ts">
/**
 * The highlights column: a count, one card per highlight in reading order,
 * and a hint at the foot.
 *
 * Reading order (by position), not creation order — the only order that lets
 * you find a highlight by remembering roughly where in the document it was.
 */
import { ref, nextTick } from 'vue'
import { useUnit } from 'effector-vue/composition'
import { Bars3BottomLeftIcon, XMarkIcon, ChevronRightIcon } from '@heroicons/vue/24/outline'

import type { HighlightColorId } from '@/shared/config/highlightColors'

import {
  $highlights,
  $highlightCount,
  $openHighlightId,
  highlightOpened,
  highlightRemoved,
  highlightColorSet,
  highlightNoteSet,
  panelToggled,
} from '../model/highlights'
import ColorSwatches from './ColorSwatches.vue'

defineProps<{ side?: 'left' | 'right' }>()

const highlights = useUnit($highlights)
const count = useUnit($highlightCount)
const openId = useUnit($openHighlightId)

/** Which card has its note field open for editing. Local, not model state:
 * it is about this panel's own UI, and closing the panel should not leave a
 * half-typed note recorded anywhere. */
const editingNoteId = ref<string | null>(null)
const noteDraft = ref('')
const noteRef = ref<HTMLTextAreaElement | null>(null)

async function startNote(id: string, current: string): Promise<void> {
  editingNoteId.value = id
  noteDraft.value = current
  await nextTick()
  noteRef.value?.focus()
  noteRef.value?.select()
}

function commitNote(id: string): void {
  highlightNoteSet({ id, note: noteDraft.value.trim() })
  editingNoteId.value = null
}

function cancelNote(): void {
  editingNoteId.value = null
}

function setColor(id: string, color: HighlightColorId): void {
  highlightColorSet({ id, color })
}

/** Long highlights are truncated in the card — the panel is a way to find a
 * highlight, not to re-read the document through a 300px column. */
const PREVIEW_LIMIT = 90

function preview(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > PREVIEW_LIMIT ? `${collapsed.slice(0, PREVIEW_LIMIT)}…` : collapsed
}
</script>

<template>
  <aside
    class="highlights-panel flex h-full flex-col print:hidden"
    :class="side === 'left' ? 'border-r' : 'border-l'"
    aria-label="Highlights"
  >
    <!-- Sentence case, not the uppercase treatment `.popover-menu-heading`
         applies — this panel gets its own class for exactly that reason. -->
    <header class="flex shrink-0 items-center gap-2 px-4 pt-4 pb-3">
      <h2 class="text-[13px] font-semibold tracking-wide">Highlights</h2>
      <span class="text-[13px] text-base-content/50">{{ count }}</span>
      <button
        type="button"
        class="panel-icon ml-auto"
        aria-label="Close highlights panel"
        @click="panelToggled()"
      >
        <ChevronRightIcon class="h-4 w-4" :class="side === 'left' ? 'rotate-180' : ''" />
      </button>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
      <p v-if="highlights.length === 0" class="px-1 py-2 text-[13px] text-base-content/50">
        No highlights yet.
      </p>

      <article
        v-for="highlight in highlights"
        :key="highlight.id"
        class="highlight-card"
        :class="{ 'highlight-card-open': openId === highlight.id }"
        :style="{ '--card-accent': `var(--md-hl-${highlight.color}-accent)` }"
      >
        <div class="flex items-start gap-2">
          <button
            type="button"
            class="quote flex-1 text-left"
            :aria-label="`Highlight: ${preview(highlight.text)}`"
            @click="highlightOpened(openId === highlight.id ? null : highlight.id)"
          >
            {{ preview(highlight.text) }}
          </button>
          <div class="flex shrink-0 flex-col gap-1">
            <button
              type="button"
              class="panel-icon"
              aria-label="Edit note"
              @click="startNote(highlight.id, highlight.note)"
            >
              <Bars3BottomLeftIcon class="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              class="panel-icon"
              aria-label="Remove highlight"
              @click="highlightRemoved(highlight.id)"
            >
              <XMarkIcon class="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div v-if="editingNoteId === highlight.id" class="mt-2">
          <textarea
            ref="noteRef"
            v-model="noteDraft"
            class="note-field"
            rows="2"
            aria-label="Highlight note"
            @keydown.meta.enter.prevent="commitNote(highlight.id)"
            @keydown.ctrl.enter.prevent="commitNote(highlight.id)"
            @keydown.esc.prevent="cancelNote"
            @blur="commitNote(highlight.id)"
          />
        </div>
        <p
          v-else-if="highlight.note !== ''"
          class="mt-1.5 flex gap-1.5 pl-0.5 text-[12.5px] leading-snug text-base-content/60"
        >
          <Bars3BottomLeftIcon class="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{{ highlight.note }}</span>
        </p>

        <!-- Colours only while the card is open, so the resting list stays a
             list of quotes rather than a wall of swatches. -->
        <div v-if="openId === highlight.id" class="mt-2">
          <ColorSwatches
            :selected="highlight.color"
            @pick="(color) => setColor(highlight.id, color)"
          />
        </div>
      </article>
    </div>

    <footer class="shrink-0 px-4 py-3 text-[12.5px] leading-snug text-base-content/45">
      Select text to add · click a highlight to edit
    </footer>
  </aside>
</template>

<style scoped>
.highlights-panel {
  width: var(--md-highlights-width);
  border-color: var(--color-base-300);
  background: var(--md-rail, var(--color-base-100));
}

/* The coloured bar is the card's left border, so it always spans the card's
 * full height however tall the quote and note make it — a separate absolutely
 * positioned element would have to be told that height. */
.highlight-card {
  margin-bottom: 4px;
  padding: 6px 8px 8px 10px;
  border-left: 3px solid var(--card-accent);
  border-radius: 0 8px 8px 0;
}

.highlight-card:hover,
.highlight-card-open {
  background: var(--md-hov, var(--color-base-200));
}

.quote {
  border: none;
  background: transparent;
  color: var(--color-base-content);
  cursor: pointer;
  font: inherit;
  font-size: 13.5px;
  line-height: 1.45;
}

.quote:focus-visible {
  outline: 2px solid var(--md-accent);
  outline-offset: 2px;
}

.panel-icon {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--color-base-content);
  cursor: pointer;
  opacity: 0.5;
}

.panel-icon:hover {
  background: var(--md-hov, var(--color-base-300));
  opacity: 1;
}

.panel-icon:focus-visible {
  outline: 2px solid var(--md-accent);
  outline-offset: -2px;
  opacity: 1;
}

.note-field {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--color-base-300);
  border-radius: 6px;
  background: var(--color-base-100);
  color: var(--color-base-content);
  font: inherit;
  font-size: 12.5px;
  resize: none;
}

.note-field:focus-visible {
  outline: 2px solid var(--md-accent);
  outline-offset: -1px;
}
</style>

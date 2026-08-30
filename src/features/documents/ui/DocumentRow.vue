<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { EllipsisHorizontalIcon } from '@heroicons/vue/24/outline'

import PopoverMenu from '@/shared/ui/PopoverMenu.vue'

import {
  documentSelected,
  documentRenamed,
  documentDuplicated,
  documentMoveRequested,
} from '../model/documents'
import type { Folder, MarkdownDocument } from '../model/types'
import HighlightedText from './HighlightedText.vue'

const props = defineProps<{
  doc: MarkdownDocument
  active: boolean
  folders: readonly Folder[]
  showTooltips?: boolean
  /** Present only when this row is rendered inside a search result list
   * (`DocumentDrawer.vue`'s search branch) — highlights the matched
   * substring in the title instead of showing it as plain text. Every
   * other rendering/behaviour of the row (rename, duplicate, move,
   * delete, the `⋯` menu) is unaffected and fully reused as-is. */
  query?: string
}>()

const emit = defineEmits<{ 'delete-requested': [event: MouseEvent] }>()

// --- Rename: a single (non-`v-for`, from this component's own point of
// view) input, so a plain template ref is safe — see `DocumentTitle.vue`'s
// doc comment for why that's *not* true one level up, inside a `v-for`.
const renaming = ref(false)
const renameValue = ref('')
const renameInputRef = ref<HTMLInputElement | null>(null)

function startRename() {
  renaming.value = true
  renameValue.value = props.doc.title
}

// Clicking the title: an unambiguous "rename" request while this row is
// already the active document (nothing left to "select"); otherwise a
// normal switch. Same rule as before this component existed.
function handleTitleClick() {
  if (props.active) {
    startRename()
  } else {
    documentSelected(props.doc.id)
  }
}

function commitRename() {
  if (!renaming.value) return
  renaming.value = false
  documentRenamed({ id: props.doc.id, title: renameValue.value })
}

function cancelRename() {
  renaming.value = false
}

watch(renaming, async (isRenaming) => {
  if (!isRenaming) return
  await nextTick()
  renameInputRef.value?.focus()
  renameInputRef.value?.select()
})

// --- Row actions menu (Phase 2 visual redesign) -----------------------
//
// The four previous inline icon buttons (rename, duplicate, move, delete)
// collapse into a single `⋯` overflow trigger — same reveal behaviour as
// before (hidden by default, shown on hover/focus-within, always shown
// under a coarse pointer/no-hover input), just one target instead of four.
// "Move to folder" used to be its own nested flyout; it's now inline in
// this same menu as a labelled sub-list, so there's still exactly one
// popover open at a time per row.
//
// Open/close state, outside-click dismissal, Escape-returns-focus, the
// Tab-trap, and the panel/item styling all live in `PopoverMenu`
// (`@/shared/ui/PopoverMenu.vue`) now — this row used to hand-roll a
// lighter version of that (no Tab-trap, no auto-focused first item) as its
// own daisyUI `.menu`/`rounded-box` dropdown; it now shares the exact same
// behaviour and surface as every other popover in the app.
const rowLabel = computed(() => props.doc.title || 'Untitled')
const menuLabel = computed(() => `Actions for ${rowLabel.value}`)

function handleRename(close: () => void) {
  close()
  startRename()
}

function handleDuplicate(close: () => void) {
  close()
  documentDuplicated(props.doc.id)
}

function moveTo(folderId: string | null, close: () => void) {
  documentMoveRequested({ id: props.doc.id, folderId })
  close()
}

function handleDelete(event: MouseEvent, close: () => void) {
  close()
  emit('delete-requested', event)
}
</script>

<template>
  <div
    class="group doc-row flex h-8 w-full items-center gap-0.5 rounded-field p-0"
    :style="active ? { background: 'var(--md-sel, var(--color-base-200))' } : undefined"
  >
    <!-- Active-document accent bar (Phase 4 visual redesign, matching the
         reference design's `barStyle`) — a bare colour indicator, not a
         fill anything sits on top of, so it reads `--color-primary`
         directly (the darker "surface" role — see "PRIMARY SURFACE/ACCENT
         SPLIT — Phase 4" in `app/styles/main.css`; measured 3.363:1+
         against every dark-theme background it can sit on, clearing the
         3:1 non-text-UI floor a decorative indicator needs). Always
         present (not `v-if`) so the row's own width/gap never shifts
         between active and inactive — only its own background colour
         toggles. -->
    <span
      class="ml-1 h-[15px] w-[3px] shrink-0 rounded-full"
      :style="{ background: active ? 'var(--color-primary)' : 'transparent' }"
      aria-hidden="true"
    />
    <input
      v-if="renaming"
      ref="renameInputRef"
      v-model="renameValue"
      type="text"
      class="input input-sm w-full"
      aria-label="Document title"
      @keydown.enter.prevent="commitRename"
      @keydown.esc.prevent="cancelRename"
      @blur="commitRename"
    />
    <template v-else>
      <button
        type="button"
        class="flex min-w-0 flex-1 items-center rounded-field px-2 py-1.5 text-left"
        :class="active ? 'cursor-text' : ''"
        :aria-current="active ? 'true' : undefined"
        :title="showTooltips && active ? 'Click to rename' : undefined"
        @click="handleTitleClick"
      >
        <span class="truncate text-xs" :class="active ? 'font-medium' : ''">
          <HighlightedText v-if="query" :text="doc.title || 'Untitled'" :query="query" />
          <template v-else>{{ doc.title || 'Untitled' }}</template>
        </span>
      </button>

      <PopoverMenu
        class="flex shrink-0 items-center pr-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100 [@media(hover:none)]:opacity-100"
        :label="menuLabel"
        align="end"
        width="176px"
        :z-index="10"
      >
        <template #trigger="{ open, toggle, setTriggerRef }">
          <button
            :ref="setTriggerRef"
            type="button"
            class="btn btn-ghost btn-xs btn-square"
            :aria-label="menuLabel"
            :title="showTooltips ? 'Actions' : undefined"
            aria-haspopup="menu"
            :aria-expanded="open"
            @click.stop="toggle"
          >
            <EllipsisHorizontalIcon class="h-3.5 w-3.5" />
          </button>
        </template>

        <template #default="{ close, setFirstItemRef }">
          <button
            :ref="setFirstItemRef"
            type="button"
            role="menuitem"
            class="popover-menu-item text-xs"
            @click.stop="handleRename(close)"
          >
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            class="popover-menu-item text-xs"
            @click.stop="handleDuplicate(close)"
          >
            Duplicate
          </button>
          <div class="popover-menu-heading">Move to</div>
          <button
            type="button"
            role="menuitem"
            class="popover-menu-item text-xs"
            :disabled="doc.folderId === null"
            @click.stop="moveTo(null, close)"
          >
            (Root)
          </button>
          <button
            v-for="folder in folders"
            :key="folder.id"
            type="button"
            role="menuitem"
            class="popover-menu-item truncate text-xs"
            :disabled="doc.folderId === folder.id"
            @click.stop="moveTo(folder.id, close)"
          >
            {{ folder.name }}
          </button>
          <div class="popover-menu-divider" role="separator" />
          <button
            type="button"
            role="menuitem"
            class="popover-menu-item popover-menu-item--danger text-xs"
            @click.stop="handleDelete($event, close)"
          >
            Delete
          </button>
        </template>
      </PopoverMenu>
    </template>
  </div>
</template>

<style scoped>
/*
 * BUG (5th occurrence of this class in the project): both `.doc-row` and
 * `.popover-menu-item` are direct children of a daisyUI `<li>` inside a
 * `<ul class="menu">`, and neither carries a `.btn` class. daisyUI's menu
 * component styles that shape on `:active` with `--menu-active-bg:
 * var(--color-neutral)` / `--menu-active-fg: var(--color-neutral-content)`
 * — both near-black/near-white and *identical in the light and dark themes*
 * (see `node_modules/daisyui/theme/{light,dark}.css`). `:active` also
 * applies to ancestors of whatever descendant is actually pressed (e.g. the
 * title button, which isn't `.btn` either), so pressing anywhere in the row
 * triggered daisyUI's dark/light-inverted flash regardless of the app's
 * theme.
 *
 * Fix: an explicit, theme-adaptive `:active` rule per the shared `ink()`/
 * `Splitter.vue` convention (raw `var(--color-*)`, un-`@layer`-ed scoped
 * CSS, which — per the CSS cascade-layers spec — always wins over daisyUI's
 * layered rule regardless of layer order or selector specificity). The
 * alpha-blend formula matches Tailwind's own `bg-primary/15` (used for the
 * resting *selected* row) at double the strength, so pressed reads as a
 * stronger, clearly distinct step up from both resting-selected (15%) and
 * daisyUI's hover tint (10% base-content, untouched here) in both themes.
 *
 * This row no longer renders inside a daisyUI `<ul class="menu">` at all
 * (its "…" menu is `PopoverMenu` now, a plain `role="menu"` div, not a
 * daisyUI menu component) — the rule stays regardless, since nothing about
 * *this* row's own `.doc-row:active` press state depended on that
 * daisyUI-menu context, and `.popover-menu-item` is still this component's
 * own scoped class on its own template elements (just passed to
 * `PopoverMenu` via a slot), so this selector still resolves correctly.
 */
.doc-row:active,
.popover-menu-item:active {
  background-color: color-mix(in oklab, var(--color-primary) 30%, transparent);
  color: var(--color-base-content);
}
</style>

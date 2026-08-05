<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { EllipsisHorizontalIcon } from '@heroicons/vue/24/outline'

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
// Dismissible via Escape or an outside click, same as the menu it
// replaces — not the heavier modal focus-trap treatment reserved for
// blocking dialogs (delete confirmations, settings), since it never blocks
// interacting with the rest of the page.
const menuOpen = ref(false)
const menuRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)

const rowLabel = computed(() => props.doc.title || 'Untitled')

function toggleMenu() {
  menuOpen.value = !menuOpen.value
}

function closeMenu() {
  menuOpen.value = false
}

function handleRename() {
  closeMenu()
  startRename()
}

function handleDuplicate() {
  closeMenu()
  documentDuplicated(props.doc.id)
}

function moveTo(folderId: string | null) {
  documentMoveRequested({ id: props.doc.id, folderId })
  closeMenu()
  triggerRef.value?.focus()
}

function handleDelete(event: MouseEvent) {
  closeMenu()
  emit('delete-requested', event)
}

function handleOutsideClick(event: MouseEvent) {
  const target = event.target as Node | null
  if (target === null) return
  if (menuRef.value?.contains(target) === true) return
  if (triggerRef.value?.contains(target) === true) return
  closeMenu()
}

watch(menuOpen, (open) => {
  if (open) {
    document.addEventListener('click', handleOutsideClick, true)
  } else {
    document.removeEventListener('click', handleOutsideClick, true)
  }
})
onBeforeUnmount(() => document.removeEventListener('click', handleOutsideClick, true))

function handleMenuKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeMenu()
    triggerRef.value?.focus()
  }
}
</script>

<template>
  <div
    class="group doc-row flex w-full items-center gap-1 p-0"
    :class="active ? 'bg-primary/15' : ''"
  >
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
        class="flex min-w-0 flex-1 items-center rounded-field px-3 py-2 text-left"
        :class="active ? 'cursor-text' : ''"
        :aria-current="active ? 'true' : undefined"
        :title="showTooltips && active ? 'Click to rename' : undefined"
        @click="handleTitleClick"
      >
        <span class="truncate text-sm">
          <HighlightedText v-if="query" :text="doc.title || 'Untitled'" :query="query" />
          <template v-else>{{ doc.title || 'Untitled' }}</template>
        </span>
      </button>
      <span
        class="relative flex shrink-0 items-center pr-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100 [@media(hover:none)]:opacity-100"
      >
        <button
          ref="triggerRef"
          type="button"
          class="btn btn-ghost btn-xs btn-square"
          :aria-label="`Actions for ${rowLabel}`"
          :title="showTooltips ? 'Actions' : undefined"
          aria-haspopup="menu"
          :aria-expanded="menuOpen"
          @click.stop="toggleMenu"
          @keydown="handleMenuKeydown"
        >
          <EllipsisHorizontalIcon class="h-3.5 w-3.5" />
        </button>

        <ul
          v-if="menuOpen"
          ref="menuRef"
          class="menu absolute right-0 top-full z-10 mt-1 w-44 rounded-box p-1 shadow-lg"
          style="
            background: var(--md-pop, var(--color-base-100));
            border: 1px solid var(--color-base-300);
          "
          role="menu"
          :aria-label="`Actions for ${rowLabel}`"
          @keydown="handleMenuKeydown"
        >
          <li role="none">
            <button
              type="button"
              role="menuitem"
              class="move-menu-item text-sm"
              @click.stop="handleRename"
            >
              Rename
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              class="move-menu-item text-sm"
              @click.stop="handleDuplicate"
            >
              Duplicate
            </button>
          </li>
          <li class="menu-title px-2 pt-2 text-xs">Move to</li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              class="move-menu-item text-sm"
              :disabled="doc.folderId === null"
              @click.stop="moveTo(null)"
            >
              (Root)
            </button>
          </li>
          <li v-for="folder in folders" :key="folder.id" role="none">
            <button
              type="button"
              role="menuitem"
              class="move-menu-item truncate text-sm"
              :disabled="doc.folderId === folder.id"
              @click.stop="moveTo(folder.id)"
            >
              {{ folder.name }}
            </button>
          </li>
          <li class="my-1 h-px" style="background: var(--color-base-300)" role="none" />
          <li role="none">
            <button
              type="button"
              role="menuitem"
              class="move-menu-item text-sm text-error"
              @click.stop="handleDelete"
            >
              Delete
            </button>
          </li>
        </ul>
      </span>
    </template>
  </div>
</template>

<style scoped>
/*
 * BUG (5th occurrence of this class in the project): both `.doc-row` and
 * `.move-menu-item` are direct children of a daisyUI `<li>` inside a
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
 */
.doc-row:active,
.move-menu-item:active {
  background-color: color-mix(in oklab, var(--color-primary) 30%, transparent);
  color: var(--color-base-content);
}
</style>

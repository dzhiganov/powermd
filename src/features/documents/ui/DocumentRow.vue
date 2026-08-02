<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  PencilSquareIcon,
  DocumentDuplicateIcon,
  TrashIcon,
  FolderArrowDownIcon,
} from '@heroicons/vue/24/outline'

import {
  documentSelected,
  documentRenamed,
  documentDuplicated,
  documentMoveRequested,
} from '../model/documents'
import type { Folder, MarkdownDocument } from '../model/types'

const props = defineProps<{
  doc: MarkdownDocument
  active: boolean
  folders: readonly Folder[]
  showTooltips?: boolean
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

// --- Move to folder: a small transient menu, not a modal — dismissible via
// Escape or an outside click, same as any other popover menu. Doesn't need
// the heavier focus-trap treatment reserved for blocking dialogs (delete
// confirmations, settings) since it never blocks interacting with the rest
// of the page.
const moveMenuOpen = ref(false)
const moveMenuRef = ref<HTMLElement | null>(null)
const moveTriggerRef = ref<HTMLButtonElement | null>(null)

function toggleMoveMenu() {
  moveMenuOpen.value = !moveMenuOpen.value
}

function closeMoveMenu() {
  moveMenuOpen.value = false
}

function moveTo(folderId: string | null) {
  documentMoveRequested({ id: props.doc.id, folderId })
  closeMoveMenu()
  moveTriggerRef.value?.focus()
}

function handleOutsideClick(event: MouseEvent) {
  const target = event.target as Node | null
  if (target === null) return
  if (moveMenuRef.value?.contains(target) === true) return
  if (moveTriggerRef.value?.contains(target) === true) return
  closeMoveMenu()
}

watch(moveMenuOpen, (open) => {
  if (open) {
    document.addEventListener('click', handleOutsideClick, true)
  } else {
    document.removeEventListener('click', handleOutsideClick, true)
  }
})
onBeforeUnmount(() => document.removeEventListener('click', handleOutsideClick, true))

function handleMoveMenuKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeMoveMenu()
    moveTriggerRef.value?.focus()
  }
}
</script>

<template>
  <div class="group flex w-full items-center gap-1 p-0" :class="active ? 'bg-primary/15' : ''">
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
        <span class="truncate text-sm">{{ doc.title || 'Untitled' }}</span>
      </button>
      <span
        class="relative flex shrink-0 items-center pr-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100 [@media(hover:none)]:opacity-100"
      >
        <button
          type="button"
          class="btn btn-ghost btn-xs btn-square"
          :aria-label="`Rename ${doc.title || 'Untitled'}`"
          :title="showTooltips ? 'Rename' : undefined"
          @click.stop="startRename"
        >
          <PencilSquareIcon class="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-xs btn-square"
          :aria-label="`Duplicate ${doc.title || 'Untitled'}`"
          :title="showTooltips ? 'Duplicate' : undefined"
          @click.stop="documentDuplicated(doc.id)"
        >
          <DocumentDuplicateIcon class="h-3.5 w-3.5" />
        </button>
        <button
          ref="moveTriggerRef"
          type="button"
          class="btn btn-ghost btn-xs btn-square"
          :aria-label="`Move ${doc.title || 'Untitled'} to folder`"
          :title="showTooltips ? 'Move to folder' : undefined"
          aria-haspopup="menu"
          :aria-expanded="moveMenuOpen"
          @click.stop="toggleMoveMenu"
          @keydown="handleMoveMenuKeydown"
        >
          <FolderArrowDownIcon class="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-xs btn-square text-error"
          :aria-label="`Delete ${doc.title || 'Untitled'}`"
          :title="showTooltips ? 'Delete' : undefined"
          @click.stop="emit('delete-requested', $event)"
        >
          <TrashIcon class="h-3.5 w-3.5" />
        </button>

        <ul
          v-if="moveMenuOpen"
          ref="moveMenuRef"
          class="menu absolute right-0 top-full z-10 mt-1 w-40 rounded-box bg-base-100 p-1 shadow-lg"
          role="menu"
          :aria-label="`Move ${doc.title || 'Untitled'} to folder`"
          @keydown="handleMoveMenuKeydown"
        >
          <li role="none">
            <button
              type="button"
              role="menuitem"
              class="text-sm"
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
              class="truncate text-sm"
              :disabled="doc.folderId === folder.id"
              @click.stop="moveTo(folder.id)"
            >
              {{ folder.name }}
            </button>
          </li>
        </ul>
      </span>
    </template>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useUnit } from 'effector-vue/composition'
import {
  PlusIcon,
  XMarkIcon,
  PencilSquareIcon,
  DocumentDuplicateIcon,
  TrashIcon,
} from '@heroicons/vue/24/outline'

import {
  $documentList,
  $activeId,
  $drawerOpen,
  $pendingDeleteDoc,
  documentCreated,
  documentSelected,
  documentRenamed,
  documentDuplicated,
  documentDeleteRequested,
  documentDeleteConfirmed,
  documentDeleteCancelled,
  drawerClosed,
} from '../model/documents'

const documents = useUnit($documentList)
const activeId = useUnit($activeId)
const open = useUnit($drawerOpen)
const pendingDelete = useUnit($pendingDeleteDoc)

// Inline rename is local UI state — the model only hears about a rename once
// it's committed (Enter or blur), never per keystroke.
const renamingId = ref<string | null>(null)
const renameValue = ref('')

function startRename(id: string, currentTitle: string) {
  renamingId.value = id
  renameValue.value = currentTitle
}

// Function ref: focuses + selects the rename input the moment it mounts.
// Avoids `ref`-in-`v-for` returning an array, and needs no `nextTick`.
function focusRenameInput(el: unknown) {
  if (el instanceof HTMLInputElement) {
    el.focus()
    el.select()
  }
}

function commitRename() {
  const id = renamingId.value
  if (id === null) return
  renamingId.value = null
  documentRenamed({ id, title: renameValue.value })
}

function cancelRename() {
  renamingId.value = null
}

// --- Delete dialog: focus management ---------------------------------------
//
// `aria-modal="true"` promises keyboard-trapped, Escape-dismissible, focus-
// managed behavior — none of which is free from `v-if` alone.
const dialogRef = ref<HTMLElement | null>(null)
const cancelButtonRef = ref<HTMLButtonElement | null>(null)
// The element that opened the dialog, so focus can return to it on close
// rather than being dropped onto `<body>`.
let triggerElement: HTMLElement | null = null

function requestDelete(id: string, event: MouseEvent) {
  triggerElement = event.currentTarget as HTMLElement | null
  documentDeleteRequested(id)
}

watch(pendingDelete, async (doc, previousDoc) => {
  if (doc !== null && previousDoc === null) {
    // Wait for the dialog to actually be in the DOM before focusing it.
    await nextTick()
    cancelButtonRef.value?.focus()
  } else if (doc === null && previousDoc !== null) {
    const trigger = triggerElement
    triggerElement = null
    if (trigger !== null && document.contains(trigger)) {
      trigger.focus()
    }
  }
})

// Minimal manual focus trap (the dialog only ever has two buttons): Tab off
// the last focusable element wraps to the first, and Shift+Tab off the
// first wraps to the last.
function trapFocus(event: KeyboardEvent) {
  const dialog = dialogRef.value
  if (!dialog) return
  const focusable = dialog.querySelectorAll<HTMLElement>('button, [href], [tabindex]')
  if (focusable.length === 0) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey) {
    if (document.activeElement === first) {
      event.preventDefault()
      last.focus()
    }
  } else if (document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
</script>

<template>
  <div>
    <!-- Backdrop: click to close. `v-show` keeps the panel mounted so its
         slide transition can run in both directions. -->
    <div
      v-show="open"
      class="fixed inset-0 z-40 bg-black/40 print:hidden"
      aria-hidden="true"
      @click="drawerClosed()"
    />

    <aside
      class="fixed inset-y-0 left-0 z-50 flex w-80 max-w-[85vw] flex-col border-r border-base-300 bg-base-200 shadow-xl transition-transform duration-200 ease-out print:hidden"
      :class="open ? 'translate-x-0' : '-translate-x-full'"
      :aria-hidden="!open"
      :inert="!open"
      aria-label="Documents"
    >
      <header class="flex h-12 shrink-0 items-center justify-between border-b border-base-300 px-3">
        <span class="text-sm font-semibold text-base-content">Documents</span>
        <div class="flex items-center gap-1">
          <button
            type="button"
            class="btn btn-primary btn-sm gap-1"
            aria-label="New document"
            @click="documentCreated()"
          >
            <PlusIcon class="h-4 w-4" />
            New
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm btn-square"
            aria-label="Close documents"
            @click="drawerClosed()"
          >
            <XMarkIcon class="h-4 w-4" />
          </button>
        </div>
      </header>

      <!-- `w-full` overrides daisyUI's `.menu { width: fit-content }`, which
           otherwise shrinks the list to its longest title instead of filling
           the drawer. -->
      <ul class="menu min-h-0 w-full flex-1 flex-nowrap gap-1 overflow-y-auto p-2">
        <li v-for="doc in documents" :key="doc.id">
          <!-- Not `menu-active`: that resolves to `--color-neutral`, which is
               the same dark value in both themes, so the active row stayed
               dark on the light theme. A primary tint over the drawer
               background adapts to whichever theme is active. The text colour
               is deliberately left to inherit from the drawer rather than set
               here, so it always tracks the active theme. -->
          <div
            class="group flex w-full items-center gap-1 p-0"
            :class="doc.id === activeId ? 'bg-primary/15' : ''"
          >
            <input
              v-if="renamingId === doc.id"
              :ref="focusRenameInput"
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
                :aria-current="doc.id === activeId ? 'true' : undefined"
                @click="documentSelected(doc.id)"
              >
                <span class="truncate text-sm">{{ doc.title || 'Untitled' }}</span>
              </button>
              <span class="flex shrink-0 items-center pr-1">
                <button
                  type="button"
                  class="btn btn-ghost btn-xs btn-square"
                  :aria-label="`Rename ${doc.title || 'Untitled'}`"
                  title="Rename"
                  @click.stop="startRename(doc.id, doc.title)"
                >
                  <PencilSquareIcon class="h-4 w-4" />
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs btn-square"
                  :aria-label="`Duplicate ${doc.title || 'Untitled'}`"
                  title="Duplicate"
                  @click.stop="documentDuplicated(doc.id)"
                >
                  <DocumentDuplicateIcon class="h-4 w-4" />
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs btn-square text-error"
                  :aria-label="`Delete ${doc.title || 'Untitled'}`"
                  title="Delete"
                  @click.stop="requestDelete(doc.id, $event)"
                >
                  <TrashIcon class="h-4 w-4" />
                </button>
              </span>
            </template>
          </div>
        </li>
      </ul>
    </aside>

    <!-- Delete confirmation. Deletion is irreversible, so it never proceeds
         without this explicit step. -->
    <div
      v-if="pendingDelete !== null"
      ref="dialogRef"
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 print:hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-dialog-title"
      tabindex="-1"
      @keydown.esc="documentDeleteCancelled()"
      @keydown.tab="trapFocus"
    >
      <div class="w-full max-w-sm rounded-box bg-base-100 p-5 shadow-xl">
        <h2 id="delete-dialog-title" class="text-base font-semibold text-base-content">
          Delete document?
        </h2>
        <p class="mt-2 text-sm text-base-content/70">
          “{{ pendingDelete.title || 'Untitled' }}” will be permanently deleted. This can’t be
          undone.
        </p>
        <div class="mt-5 flex justify-end gap-2">
          <button
            ref="cancelButtonRef"
            type="button"
            class="btn btn-ghost btn-sm"
            @click="documentDeleteCancelled()"
          >
            Cancel
          </button>
          <button type="button" class="btn btn-error btn-sm" @click="documentDeleteConfirmed()">
            Delete
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

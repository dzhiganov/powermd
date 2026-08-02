<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useUnit } from 'effector-vue/composition'
import { PlusIcon, FolderPlusIcon } from '@heroicons/vue/24/outline'

import { useDialogFocusTrap } from '@/shared/lib/useDialog'
import { ink } from '@/shared/lib/ink'

import {
  $documentList,
  $activeId,
  $drawerOpen,
  $pendingDeleteDoc,
  $folders,
  $pendingFolderDeleteDoc,
  $collapsedFolderIds,
  $dbBlocked,
  documentCreated,
  documentDeleteRequested,
  documentDeleteConfirmed,
  documentDeleteCancelled,
  drawerClosed,
  folderCreated,
  folderDeleteRequested,
  folderDeleteConfirmed,
  folderDeleteCancelled,
} from '../model/documents'
import DocumentRow from './DocumentRow.vue'
import FolderGroup from './FolderGroup.vue'

// `showTooltips` and `side` come in as props rather than a direct
// `@/features/settings` import — `documents` and `settings` never import
// each other's internals (see ARCHITECTURE.md / eslint boundaries). The
// single mounting site, `AppShell.vue` (in the `layout` feature), already
// imports `settings` directly and threads both values down.
withDefaults(defineProps<{ showTooltips?: boolean; side?: 'left' | 'right' }>(), {
  side: 'right',
})

const documents = useUnit($documentList)
const activeId = useUnit($activeId)
const open = useUnit($drawerOpen)
const pendingDelete = useUnit($pendingDeleteDoc)
const folders = useUnit($folders)
const pendingFolderDelete = useUnit($pendingFolderDeleteDoc)
const collapsedFolderIds = useUnit($collapsedFolderIds)
const dbBlocked = useUnit($dbBlocked)

// Folders sort alphabetically (case-insensitive) — flat, no manual
// reordering (out of scope; moving is a per-document menu action, not
// drag-and-drop, and there's no folder-reordering feature at all).
const sortedFolders = computed(() =>
  [...folders.value].sort((a, b) => a.name.localeCompare(b.name)),
)
const rootDocuments = computed(() => documents.value.filter((doc) => doc.folderId === null))
function documentsInFolder(folderId: string) {
  return documents.value.filter((doc) => doc.folderId === folderId)
}
function isCollapsed(folderId: string): boolean {
  return collapsedFolderIds.value.includes(folderId)
}

// --- Creating a folder: inline input, same shape as a document rename ------

const creatingFolder = ref(false)
const newFolderName = ref('')
const newFolderInputRef = ref<HTMLInputElement | null>(null)

function startCreateFolder() {
  creatingFolder.value = true
  newFolderName.value = ''
}

function commitCreateFolder() {
  if (!creatingFolder.value) return
  creatingFolder.value = false
  // Blank still creates a folder (falls back to "Untitled folder" in the
  // model) rather than silently doing nothing — same reasoning as a blank
  // document rename: silently discarding the attempt would look like it
  // succeeded when it didn't.
  folderCreated(newFolderName.value)
}

function cancelCreateFolder() {
  creatingFolder.value = false
}

watch(creatingFolder, async (isCreating) => {
  if (!isCreating) return
  await nextTick()
  newFolderInputRef.value?.focus()
})

// --- Delete dialog (documents): focus management ---------------------------
//
// `aria-modal="true"` promises keyboard-trapped, Escape-dismissible, focus-
// managed behavior — none of which is free from `v-if` alone. Kept as its
// own manual trap (predates `useDialogFocusTrap`) because a document row's
// delete button is one of many identical candidates — the trigger is
// captured explicitly from the click event rather than inferred from
// `document.activeElement`.
const dialogRef = ref<HTMLElement | null>(null)
const cancelButtonRef = ref<HTMLButtonElement | null>(null)
let triggerElement: HTMLElement | null = null

function requestDelete(id: string, event: MouseEvent) {
  triggerElement = event.currentTarget as HTMLElement | null
  documentDeleteRequested(id)
}

watch(pendingDelete, async (doc, previousDoc) => {
  if (doc !== null && previousDoc === null) {
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

// --- Delete dialog (folders): shared focus-trap helper ---------------------
//
// A folder's delete button is also one of several identical candidates, but
// `useDialogFocusTrap` captures `document.activeElement` at the instant the
// dialog opens — which, for a click-triggered open, *is* the clicked
// button regardless of how many other candidates exist elsewhere in the
// list. Used here (rather than the manual pattern above) since this is a
// brand-new dialog with no existing behavior to risk regressing.
const folderDialogRef = ref<HTMLElement | null>(null)
const folderCancelButtonRef = ref<HTMLButtonElement | null>(null)
const folderDeleteOpen = computed(() => pendingFolderDelete.value !== null)
const { trapFocus: trapFolderDialogFocus } = useDialogFocusTrap(
  folderDialogRef,
  folderDeleteOpen,
  folderCancelButtonRef,
)
</script>

<template>
  <!-- `contents`: this wrapper must not introduce a box of its own — the
       `<aside>` below needs to participate directly as a flex item of
       `AppShell.vue`'s docked-drawer row on desktop. The backdrop and the
       delete dialogs are both `fixed`, so they're unaffected by their
       ancestor having no box (fixed positioning is relative to the
       viewport regardless). -->
  <div class="contents">
    <!-- Backdrop: click to close. `v-show` keeps the panel mounted so its
         slide transition can run in both directions. Mobile-only — on
         desktop the drawer is a docked sidebar with no backdrop, or an
         open-by-default overlay would dim the whole app on first load. -->
    <div
      v-show="open"
      class="fixed inset-0 z-40 bg-black/40 md:hidden print:hidden"
      aria-hidden="true"
      @click="drawerClosed()"
    />

    <!-- Below `md`: a fixed overlay, sliding in from `side` with a backdrop
         (unchanged from before). At `md` and up: a docked sidebar that
         participates in `AppShell.vue`'s layout — `md:static` drops it out
         of fixed positioning.

         This element is a pure *space-reclaiming clip box* — it owns the
         width that grows/shrinks (`md:w-80`/`md:w-0`) so the editor/preview
         panes actually resize as the drawer opens/closes, and
         `md:overflow-hidden` clips the panel while that width animates. It
         deliberately owns NO visual chrome and NO movement of its own: the
         inner panel below is what slides and what renders the content, so
         nothing here ever changes the panel's own box and nothing here
         forces the panel's children to reflow. On mobile this element's
         width never changes (only the `md:w-*` pair does), so there's no
         width animation to reclaim space from at all — the overlay is
         `fixed` and out of flow already. -->
    <aside
      class="fixed inset-y-0 z-50 w-80 max-w-[85vw] transition-none print:hidden md:static md:z-auto md:max-w-none md:shrink-0 md:overflow-hidden md:transition-[width] md:duration-300 md:ease-out motion-reduce:md:transition-none"
      :class="[side === 'right' ? 'right-0 order-2' : 'left-0', open ? 'md:w-80' : 'md:w-0']"
      :aria-hidden="!open"
      :inert="!open"
      aria-label="Documents"
    >
      <!-- The actual panel: a *constant* width (`w-80 max-w-[85vw]`, never
           overridden per breakpoint or open state) so its children never
           reflow — it is effectively pre-rendered off-screen and only ever
           moves. Movement is `transform: translateX(...)` only (composited,
           no layout impact), on the same duration/easing as the wrapper's
           width transition above so the slide and the space reclamation
           stay in sync. All visual chrome (border, shadow, background)
           lives here rather than on the clip box, since this is the box
           that's actually visible. -->
      <div
        class="flex h-full w-80 max-w-[85vw] flex-col border-base-300 bg-base-200 shadow-xl transition-transform duration-300 ease-out motion-reduce:transition-none md:max-w-none md:shadow-none"
        :class="[
          side === 'right' ? 'border-l' : 'border-r',
          open ? 'translate-x-0' : side === 'right' ? 'translate-x-full' : '-translate-x-full',
        ]"
      >
        <!-- No heading text and no close button — the drawer is opened and
             closed from the toolbar's toggle (and, on mobile, the backdrop),
             not from a control in here (see `DrawerToggleButton.vue`). The
             accessible name for the region now lives solely on the `<aside>`
             above via `aria-label="Documents"`; it must stay there since
             there's no visible heading to fall back on. Fixed left-aligned
             layout — this header no longer mirrors with `side`, matching the
             toolbar above it. -->
        <header class="flex h-12 shrink-0 items-center gap-1 border-b border-base-300 px-3">
          <button
            type="button"
            class="btn btn-ghost btn-xs btn-square"
            aria-label="New folder"
            :title="showTooltips ? 'New folder' : undefined"
            @click="startCreateFolder"
          >
            <FolderPlusIcon class="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            class="btn btn-primary btn-xs gap-1"
            aria-label="New document"
            @click="documentCreated()"
          >
            <PlusIcon class="h-3.5 w-3.5" />
            New
          </button>
        </header>

        <!-- Blocked-upgrade notice: see `db.subscribeToDatabaseBlocked` /
             `$dbBlocked`'s doc comment. Deliberately visible and specific
             (not folded into the generic "storage unavailable" state) —
             this is the recoverable case where closing another tab fixes
             it. -->
        <div
          v-if="dbBlocked"
          class="border-b border-warning/40 bg-warning/10 px-3 py-2 text-xs"
          :style="{ color: ink('--color-warning') }"
          role="status"
          aria-live="polite"
        >
          Another tab has this app open with an older version, so your documents couldn't load.
          Close that tab, then reload this page.
        </div>

        <!-- `w-full` overrides daisyUI's `.menu { width: fit-content }`, which
             otherwise shrinks the list to its longest title instead of filling
             the drawer. -->
        <ul class="menu min-h-0 w-full flex-1 flex-nowrap gap-1 overflow-y-auto p-2">
          <li v-if="creatingFolder">
            <input
              ref="newFolderInputRef"
              v-model="newFolderName"
              type="text"
              class="input input-sm w-full"
              placeholder="Folder name"
              aria-label="New folder name"
              @keydown.enter.prevent="commitCreateFolder"
              @keydown.esc.prevent="cancelCreateFolder"
              @blur="commitCreateFolder"
            />
          </li>

          <FolderGroup
            v-for="folder in sortedFolders"
            :key="folder.id"
            :folder="folder"
            :documents="documentsInFolder(folder.id)"
            :all-folders="folders"
            :active-id="activeId"
            :collapsed="isCollapsed(folder.id)"
            :show-tooltips="showTooltips"
            @delete-requested="folderDeleteRequested(folder.id)"
            @document-delete-requested="requestDelete"
          />

          <li v-for="doc in rootDocuments" :key="doc.id">
            <DocumentRow
              :doc="doc"
              :active="doc.id === activeId"
              :folders="folders"
              :show-tooltips="showTooltips"
              @delete-requested="(event) => requestDelete(doc.id, event)"
            />
          </li>
        </ul>
      </div>
    </aside>

    <!-- Delete confirmation (document). Deletion is irreversible, so it
         never proceeds without this explicit step. -->
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

    <!-- Delete confirmation (folder). States plainly that the documents
         inside survive and move to root — deleting a folder must never
         read as "and everything in it". -->
    <div
      v-if="pendingFolderDelete !== null"
      ref="folderDialogRef"
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 print:hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-folder-dialog-title"
      tabindex="-1"
      @keydown.esc="folderDeleteCancelled()"
      @keydown.tab="trapFolderDialogFocus"
    >
      <div class="w-full max-w-sm rounded-box bg-base-100 p-5 shadow-xl">
        <h2 id="delete-folder-dialog-title" class="text-base font-semibold text-base-content">
          Delete folder?
        </h2>
        <p class="mt-2 text-sm text-base-content/70">
          “{{ pendingFolderDelete.name }}” will be deleted. The documents inside it are kept and
          moved to the root — they are not deleted.
        </p>
        <div class="mt-5 flex justify-end gap-2">
          <button
            ref="folderCancelButtonRef"
            type="button"
            class="btn btn-ghost btn-sm"
            @click="folderDeleteCancelled()"
          >
            Cancel
          </button>
          <button type="button" class="btn btn-error btn-sm" @click="folderDeleteConfirmed()">
            Delete
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

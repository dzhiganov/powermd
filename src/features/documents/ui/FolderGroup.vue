<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisHorizontalIcon,
  FolderIcon,
} from '@heroicons/vue/24/outline'

import { folderCollapseToggled, folderRenamed } from '../model/documents'
import type { Folder, MarkdownDocument } from '../model/types'
import DocumentRow from './DocumentRow.vue'

const props = defineProps<{
  folder: Folder
  documents: readonly MarkdownDocument[]
  allFolders: readonly Folder[]
  activeId: string | null
  collapsed: boolean
  showTooltips?: boolean
}>()

const emit = defineEmits<{
  'delete-requested': [event: MouseEvent]
  'document-delete-requested': [id: string, event: MouseEvent]
}>()

// Same shape as `DocumentRow.vue`'s own rename — a single input scoped to
// this component instance, so a plain template ref is safe even though
// `FolderGroup` itself is rendered in a `v-for` one level up (unlike a
// plain `ref="..."` on an element *inside* that `v-for`, which Vue would
// collect into an array).
const renaming = ref(false)
const renameValue = ref('')
const renameInputRef = ref<HTMLInputElement | null>(null)

function startRename() {
  renaming.value = true
  renameValue.value = props.folder.name
}

function commitRename() {
  if (!renaming.value) return
  renaming.value = false
  folderRenamed({ id: props.folder.id, name: renameValue.value })
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
// Same consolidation as `DocumentRow.vue`: the two previous inline icon
// buttons (rename, delete) collapse into a single `⋯` overflow trigger,
// same reveal behaviour (hidden by default, shown on hover/focus-within,
// always shown under a coarse pointer/no-hover input) and the same
// dismiss-on-outside-click/Escape popover shape as that component.
const menuOpen = ref(false)
const menuRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)

const folderLabel = computed(() => props.folder.name)

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

// Right-aligned document count (Phase 4 visual redesign, matching the
// reference design's `n.count`) — a plain length off the already-filtered
// `documents` prop (this folder's own documents, passed down by
// `DocumentDrawer.vue`), not a second store read.
const documentCount = computed(() => String(props.documents.length))
</script>

<template>
  <li>
    <!-- Folder row (Phase 4 visual redesign, matching the reference
         design): a disclosure chevron, folder icon, the name at normal
         text weight+size (heavier than a document row's own weight, not
         the small uppercase "section label" treatment this replaces), a
         right-aligned document count, then the `⋯` menu — same row height
         as a document row (`h-8`) for one even rhythm down the whole
         tree. -->
    <div class="group folder-row flex h-8 w-full items-center gap-1.5 rounded-field px-1">
      <button
        type="button"
        class="btn btn-ghost btn-xs btn-square shrink-0"
        :aria-label="collapsed ? `Expand ${folder.name}` : `Collapse ${folder.name}`"
        :aria-expanded="!collapsed"
        :title="showTooltips ? (collapsed ? 'Expand folder' : 'Collapse folder') : undefined"
        @click="folderCollapseToggled(folder.id)"
      >
        <ChevronRightIcon v-if="collapsed" class="h-3.5 w-3.5" />
        <ChevronDownIcon v-else class="h-3.5 w-3.5" />
      </button>
      <FolderIcon class="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
      <input
        v-if="renaming"
        ref="renameInputRef"
        v-model="renameValue"
        type="text"
        class="input input-sm min-w-0 flex-1"
        aria-label="Folder name"
        @keydown.enter.prevent="commitRename"
        @keydown.esc.prevent="cancelRename"
        @blur="commitRename"
      />
      <button
        v-else
        type="button"
        class="min-w-0 flex-1 truncate rounded-field py-1 text-left text-sm font-medium"
        @click="folderCollapseToggled(folder.id)"
      >
        {{ folder.name }}
      </button>
      <span
        v-if="!renaming"
        class="shrink-0 font-mono text-[10.5px]"
        style="color: var(--md-t4, var(--color-base-content))"
        aria-hidden="true"
      >
        {{ documentCount }}
      </span>
      <span
        class="relative flex shrink-0 items-center opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100 [@media(hover:none)]:opacity-100"
      >
        <button
          ref="triggerRef"
          type="button"
          class="btn btn-ghost btn-xs btn-square"
          :aria-label="`Actions for ${folderLabel}`"
          :title="showTooltips ? 'Folder actions' : undefined"
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
          class="menu absolute right-0 top-full z-10 mt-1 w-40 rounded-box p-1 shadow-lg"
          style="
            background: var(--md-pop, var(--color-base-100));
            border: 1px solid var(--color-base-300);
          "
          role="menu"
          :aria-label="`Actions for ${folderLabel}`"
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
              class="move-menu-item text-sm text-error"
              @click.stop="handleDelete"
            >
              Delete
            </button>
          </li>
        </ul>
      </span>
    </div>

    <!-- `ml-4`, not `ml-5`: this border is the guide line running down from
         the folder's collapse chevron, so it should sit under the chevron's
         centre. At `ml-5` it landed 4px to its right (measured: chevron
         centre 985, line 989), which reads as a misalignment rather than as
         a connection. -->
    <ul v-show="!collapsed" class="ml-4 flex flex-col gap-1 border-l border-base-300 pl-3">
      <li v-if="documents.length === 0" class="px-3 py-1 text-xs text-base-content/50">Empty</li>
      <li v-for="doc in documents" :key="doc.id">
        <DocumentRow
          :doc="doc"
          :active="doc.id === activeId"
          :folders="allFolders"
          :show-tooltips="showTooltips"
          @delete-requested="(event) => emit('document-delete-requested', doc.id, event)"
        />
      </li>
    </ul>
  </li>
</template>

<style scoped>
/* Same daisyUI `.menu` `:active` defect as `DocumentRow.vue` — see that
 * file's `<style>` comment for the root cause. This row wrapper is also a
 * direct, non-`.btn` child of a `.menu`'s `<li>`, so it needs the same
 * theme-adaptive override. `.move-menu-item` is shared with `DocumentRow`'s
 * scoped block but Vue's `scoped` attribute-selector means each component's
 * copy only ever matches its own template — declaring it again here is
 * required, not redundant. */
.folder-row:active {
  background-color: color-mix(in oklab, var(--color-primary) 30%, transparent);
  color: var(--color-base-content);
}

.move-menu-item:active {
  background-color: color-mix(in oklab, var(--color-primary) 30%, transparent);
  color: var(--color-base-content);
}
</style>

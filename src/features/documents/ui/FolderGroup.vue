<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisHorizontalIcon,
  FolderIcon,
} from '@heroicons/vue/24/outline'

import PopoverMenu from '@/shared/ui/PopoverMenu.vue'

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
// always shown under a coarse pointer/no-hover input). Open/close state,
// outside-click dismissal, Escape-returns-focus, the Tab-trap, and the
// panel/item styling all live in `PopoverMenu` (`@/shared/ui/
// PopoverMenu.vue`) now, the same shared implementation `DocumentRow.vue`
// uses for its own row menu.
const folderLabel = computed(() => props.folder.name)
const menuLabel = computed(() => `Actions for ${folderLabel.value}`)

function handleRename(close: () => void) {
  close()
  startRename()
}

function handleDelete(event: MouseEvent, close: () => void) {
  close()
  emit('delete-requested', event)
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
         as a document row (`h-7`) for one even rhythm down the whole
         tree. -->
    <div class="group folder-row flex h-7 w-full items-center gap-1.5 rounded-field px-1">
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
        class="folder-name min-w-0 flex-1 truncate rounded-field py-1 text-left text-xs font-medium"
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

      <PopoverMenu
        class="flex shrink-0 items-center opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100 [@media(hover:none)]:opacity-100"
        :label="menuLabel"
        align="end"
        width="160px"
        :z-index="10"
      >
        <template #trigger="{ open, toggle, setTriggerRef }">
          <button
            :ref="setTriggerRef"
            type="button"
            class="btn btn-ghost btn-xs btn-square"
            :aria-label="menuLabel"
            :title="showTooltips ? 'Folder actions' : undefined"
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
            class="popover-menu-item popover-menu-item--danger text-xs"
            @click.stop="handleDelete($event, close)"
          >
            Delete
          </button>
        </template>
      </PopoverMenu>
    </div>

    <!-- No guide line. There was a `border-l` running down from the folder's
         chevron; indentation alone already says these rows belong to the
         folder above, and the rule was one more piece of furniture in a
         panel that is mostly text. Kept at the same total inset so nothing
         shifts sideways when a folder is expanded. -->
    <!-- `gap-0.5` matches the parent list in `DocumentDrawer.vue` (see its
         own comment) — a folder's children must not sit further apart than
         the root-level rows around them. -->
    <ul v-show="!collapsed" class="ml-4 flex flex-col gap-0.5 pl-3">
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
 * file's `<style>` comment for the root cause and why this row's own
 * `:active` rule stays even though its "…" menu is `PopoverMenu`
 * (`@/shared/ui/PopoverMenu.vue`) now, not a daisyUI menu component.
 * `.popover-menu-item` is shared with `DocumentRow.vue`'s scoped block but
 * Vue's `scoped` attribute-selector means each component's copy only ever
 * matches its own template — declaring it again here is required, not
 * redundant. */
.folder-row:active {
  background-color: color-mix(in oklab, var(--color-primary) 30%, transparent);
  color: var(--color-base-content);
}

.popover-menu-item:active {
  background-color: color-mix(in oklab, var(--color-primary) 30%, transparent);
  color: var(--color-base-content);
}

/* Folders are dimmed unconditionally, unlike document rows which dim only
 * when they are not the open one. A folder is never "the open document" —
 * there is no selected state for it to hold — so it is always part of the
 * surroundings the open document stands out FROM. Same token and the same
 * hover lift as `DocumentRow.vue`, so a folder and a document sitting next
 * to each other in the list read at the same weight. */
.folder-name {
  opacity: var(--md-row-muted);
  transition: opacity 120ms ease;
}

.folder-row:hover .folder-name {
  opacity: 1;
}
</style>

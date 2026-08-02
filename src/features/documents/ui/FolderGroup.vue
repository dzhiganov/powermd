<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  PencilSquareIcon,
  TrashIcon,
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
</script>

<template>
  <li>
    <div class="group flex w-full items-center gap-1 py-0.5">
      <button
        type="button"
        class="btn btn-ghost btn-xs btn-square shrink-0"
        :aria-label="collapsed ? `Expand ${folder.name}` : `Collapse ${folder.name}`"
        :aria-expanded="!collapsed"
        :title="showTooltips ? (collapsed ? 'Expand folder' : 'Collapse folder') : undefined"
        @click="folderCollapseToggled(folder.id)"
      >
        <ChevronRightIcon v-if="collapsed" class="h-4 w-4" />
        <ChevronDownIcon v-else class="h-4 w-4" />
      </button>
      <FolderIcon class="h-4 w-4 shrink-0 text-base-content/60" aria-hidden="true" />
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
        class="min-w-0 flex-1 truncate rounded-field px-1 py-1 text-left text-sm font-medium"
        @click="folderCollapseToggled(folder.id)"
      >
        {{ folder.name }}
      </button>
      <span class="flex shrink-0 items-center pr-1">
        <button
          type="button"
          class="btn btn-ghost btn-xs btn-square"
          :aria-label="`Rename ${folder.name}`"
          :title="showTooltips ? 'Rename folder' : undefined"
          @click.stop="startRename"
        >
          <PencilSquareIcon class="h-4 w-4" />
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-xs btn-square text-error"
          :aria-label="`Delete ${folder.name}`"
          :title="showTooltips ? 'Delete folder' : undefined"
          @click.stop="emit('delete-requested', $event)"
        >
          <TrashIcon class="h-4 w-4" />
        </button>
      </span>
    </div>

    <ul v-show="!collapsed" class="ml-5 flex flex-col gap-1 border-l border-base-300 pl-2">
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

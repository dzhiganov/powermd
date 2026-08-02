<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { useUnit } from 'effector-vue/composition'

import { $activeDocument, documentRenamed } from '../model/documents'

// See `DrawerToggleButton.vue` for why this is a prop rather than a direct
// `@/features/settings` import.
defineProps<{ showTooltips?: boolean }>()

const active = useUnit($activeDocument)

// Same shape as `DocumentDrawer.vue`'s inline rename — local UI state only;
// the model only hears about a rename once it's committed (Enter or blur).
const renaming = ref(false)
const renameValue = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

// A single, non-`v-for` input, so a plain template ref is safe here (unlike
// `DocumentDrawer.vue`'s per-row rename input): Vue assigns `inputRef` once
// when the `v-if` mounts it, not on every keystroke re-render, so there's no
// version of the "function ref fires on every render" bug to guard against.
async function startRename() {
  if (active.value === null) return
  renameValue.value = active.value.title
  renaming.value = true
  await nextTick()
  inputRef.value?.focus()
  inputRef.value?.select()
}

function commitRename() {
  if (!renaming.value || active.value === null) return
  renaming.value = false
  documentRenamed({ id: active.value.id, title: renameValue.value })
}

function cancelRename() {
  renaming.value = false
}
</script>

<template>
  <input
    v-if="renaming"
    ref="inputRef"
    v-model="renameValue"
    type="text"
    class="input input-sm min-w-0 max-w-[10rem] sm:max-w-[16rem]"
    aria-label="Document title"
    @keydown.enter.prevent="commitRename"
    @keydown.esc.prevent="cancelRename"
    @blur="commitRename"
  />
  <button
    v-else
    type="button"
    class="btn btn-ghost btn-sm min-w-0 max-w-[10rem] justify-start truncate font-medium sm:max-w-[16rem]"
    aria-label="Rename document"
    :title="showTooltips ? 'Rename document' : undefined"
    @click="startRename"
  >
    {{ active?.title || 'Untitled' }}
  </button>
</template>

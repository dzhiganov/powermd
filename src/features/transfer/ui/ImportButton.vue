<script setup lang="ts">
import { ref } from 'vue'
import { ArrowUpTrayIcon } from '@heroicons/vue/24/outline'
import { useUnit } from 'effector-vue/composition'

import { $showTooltips } from '@/features/settings'

import { ACCEPTED_EXTENSIONS_LIST, ACCEPTED_INPUT_ATTR } from '../lib/fileValidation'
import { filePickerFilesSelected } from '../model/transfer'

// `menuItem`: renders as a full-width labelled row instead of a standalone
// icon button, for embedding inside `layout/ui/MoreMenu.vue`'s popover —
// same file-picker logic either way (`openPicker`/`handleChange`/the hidden
// `<input>` below), just a different trigger element, so import behaviour is
// defined in exactly one place regardless of where the button is rendered.
//
// This is now the ONLY rendering actually used: import moved off the
// documents panel's tools row and into that popover, alongside the theme
// cycle and the export actions (user request). The icon-button branch is
// kept because it costs one `v-else` and is the shape any future toolbar
// would want.
withDefaults(defineProps<{ menuItem?: boolean }>(), { menuItem: false })

// Fired every time the picker is opened — listened to by `MoreMenu.vue`,
// which closes the popover once the picker takes over. The plain icon-button
// rendering has no listener attached, so this is a no-op there.
const emit = defineEmits<{ picked: [] }>()

const showTooltips = useUnit($showTooltips)
const input = ref<HTMLInputElement | null>(null)

function openPicker(): void {
  input.value?.click()
  emit('picked')
}

function handleChange(event: Event): void {
  const target = event.target as HTMLInputElement
  const files = Array.from(target.files ?? [])
  if (files.length > 0) filePickerFilesSelected(files)
  // Reset so picking the exact same file again still fires `change` —
  // otherwise a second selection of an identical path/name is a no-op.
  target.value = ''
}
</script>

<template>
  <button
    v-if="menuItem"
    type="button"
    role="menuitem"
    class="popover-menu-item"
    @click="openPicker"
  >
    <ArrowUpTrayIcon class="h-3.5 w-3.5 shrink-0" />
    Import ({{ ACCEPTED_EXTENSIONS_LIST }})
  </button>
  <button
    v-else
    type="button"
    class="btn btn-ghost btn-xs btn-square print:hidden"
    aria-label="Import document"
    :title="showTooltips ? `Import (${ACCEPTED_EXTENSIONS_LIST})` : undefined"
    @click="openPicker"
  >
    <ArrowUpTrayIcon class="h-3.5 w-3.5" />
  </button>
  <input
    ref="input"
    type="file"
    class="hidden"
    multiple
    :accept="ACCEPTED_INPUT_ATTR"
    @change="handleChange"
  />
</template>

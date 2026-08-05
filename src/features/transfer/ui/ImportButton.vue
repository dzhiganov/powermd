<script setup lang="ts">
import { ref } from 'vue'
import { ArrowUpTrayIcon } from '@heroicons/vue/24/outline'
import { useUnit } from 'effector-vue/composition'

import { $showTooltips } from '@/features/settings'

import { ACCEPTED_EXTENSIONS_LIST, ACCEPTED_INPUT_ATTR } from '../lib/fileValidation'
import { filePickerFilesSelected } from '../model/transfer'

// `menuItem` (Phase 2 visual redesign): renders as a full-width labelled
// row instead of a standalone icon button, for embedding inside
// `layout/ui/MoreMenu.vue`'s popover — same file-picker logic either way
// (`openPicker`/`handleChange`/the hidden `<input>` below), just a
// different trigger element, so import behaviour is defined in exactly one
// place regardless of where the button is rendered.
withDefaults(defineProps<{ menuItem?: boolean }>(), { menuItem: false })

// Fired every time the picker is opened — only listened to by `MoreMenu.vue`
// (`menuItem` mode), which closes the popover once the picker takes over.
// The plain icon-button rendering has no listener attached, so this is a
// no-op there.
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
  <button v-if="menuItem" type="button" role="menuitem" class="more-menu-item" @click="openPicker">
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

<style scoped>
/* Shared menu-row look with `layout/ui/MoreMenu.vue`'s own items — this
 * component renders inside that popover but can't reach its scoped
 * styles (Vue scoping is per-component), so the class is redefined
 * identically here. Kept minimal/plain (no colour override) so it inherits
 * `--md-pop`'s theme-adaptive text colour the same way the sibling
 * `<button>`s in that popover do. */
.more-menu-item {
  width: 100%;
  padding: 7px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-base-content);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  text-align: left;
  white-space: nowrap;
}

.more-menu-item:hover,
.more-menu-item:focus-visible {
  background: var(--md-hov, var(--color-base-200));
}

.more-menu-item:focus-visible {
  outline: 2px solid var(--md-accent);
  outline-offset: -2px;
}
</style>

<script setup lang="ts">
import { ref } from 'vue'
import { ArrowUpTrayIcon } from '@heroicons/vue/24/outline'

import { ACCEPTED_EXTENSIONS_LIST, ACCEPTED_INPUT_ATTR } from '../lib/fileValidation'
import { filePickerFilesSelected } from '../model/transfer'

const input = ref<HTMLInputElement | null>(null)

function openPicker(): void {
  input.value?.click()
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
    type="button"
    class="btn btn-ghost btn-sm btn-square print:hidden"
    aria-label="Import document"
    :title="`Import (${ACCEPTED_EXTENSIONS_LIST})`"
    @click="openPicker"
  >
    <ArrowUpTrayIcon class="h-4 w-4" />
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

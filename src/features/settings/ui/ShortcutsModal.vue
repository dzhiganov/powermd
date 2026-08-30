<script setup lang="ts">
import { ref } from 'vue'
import { useUnit } from 'effector-vue/composition'
import { XMarkIcon } from '@heroicons/vue/24/outline'

import { useDialogFocusTrap } from '@/shared/lib/useDialog'
import { formatShortcut } from '@/shared/lib/platform'
import { EDITOR_SHORTCUTS } from '@/features/editor'

import { $helpOpen, helpClosed } from '../model/dialogs'

const open = useUnit($helpOpen)
const dialogRef = ref<HTMLElement | null>(null)
const firstControlRef = ref<HTMLElement | null>(null)
const { trapFocus } = useDialogFocusTrap(dialogRef, open, firstControlRef)
</script>

<template>
  <div
    v-if="open"
    ref="dialogRef"
    class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 print:hidden"
    role="dialog"
    aria-modal="true"
    aria-labelledby="shortcuts-dialog-title"
    tabindex="-1"
    @keydown.esc="helpClosed()"
    @keydown.tab="trapFocus"
  >
    <div class="w-full max-w-sm rounded-box bg-base-100 p-5 shadow-xl">
      <div class="flex items-center justify-between">
        <h2 id="shortcuts-dialog-title" class="text-xs font-semibold text-base-content">
          Keyboard shortcuts
        </h2>
        <button
          ref="firstControlRef"
          type="button"
          class="btn btn-ghost btn-sm btn-square"
          aria-label="Close keyboard shortcuts"
          @click="helpClosed()"
        >
          <XMarkIcon class="h-4 w-4" />
        </button>
      </div>
      <ul class="mt-4 flex flex-col gap-2">
        <li
          v-for="shortcut in EDITOR_SHORTCUTS"
          :key="shortcut.keys"
          class="flex items-center justify-between gap-4 text-xs"
        >
          <span class="text-base-content">{{ shortcut.description }}</span>
          <kbd class="kbd kbd-sm">{{ formatShortcut(shortcut.keys) }}</kbd>
        </li>
      </ul>
    </div>
  </div>
</template>

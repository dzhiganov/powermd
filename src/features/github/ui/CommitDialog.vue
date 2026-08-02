<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useUnit } from 'effector-vue/composition'
import { XMarkIcon } from '@heroicons/vue/24/outline'

import { useDialogFocusTrap } from '@/shared/lib/useDialog'
import { ink } from '@/shared/lib/ink'

import {
  $commitDialogOpen,
  $commitStatus,
  $commitError,
  $activeDocumentForCommit,
  commitDialogClosed,
  commitRequested,
  conflictOverwriteRequested,
  conflictKeepLocalRequested,
  conflictReloadRemoteRequested,
} from '../model/commit'

const open = useUnit($commitDialogOpen)
const status = useUnit($commitStatus)
const error = useUnit($commitError)
const activeDoc = useUnit($activeDocumentForCommit)

const dialogRef = ref<HTMLElement | null>(null)
const firstControlRef = ref<HTMLElement | null>(null)
const { trapFocus } = useDialogFocusTrap(dialogRef, open, firstControlRef)

const message = ref('')

function basename(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? path : path.slice(idx + 1)
}

// The repo-relative path being committed, for the dialog subtitle.
const targetPath = computed(() => activeDoc.value?.origin.path ?? '')

// Seed a sensible default message each time the dialog opens.
watch(open, (isOpen) => {
  if (isOpen && activeDoc.value !== null) {
    message.value = `Update ${basename(activeDoc.value.origin.path)}`
  }
})

const committing = computed(() => status.value === 'committing')
const inConflict = computed(() => status.value === 'conflict')

function submit() {
  if (message.value.trim() === '' || committing.value) return
  commitRequested({ message: message.value })
}

const errorInk = computed(() => ({ color: ink('--color-error') }))
</script>

<template>
  <div
    v-if="open"
    ref="dialogRef"
    class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 print:hidden"
    role="dialog"
    aria-modal="true"
    aria-labelledby="commit-dialog-title"
    tabindex="-1"
    @keydown.esc="commitDialogClosed()"
    @keydown.tab="trapFocus"
  >
    <div class="w-full max-w-sm rounded-box bg-base-100 p-5 shadow-xl">
      <div class="flex items-center justify-between">
        <h2 id="commit-dialog-title" class="text-base font-semibold text-base-content">
          {{ inConflict ? 'File changed on GitHub' : 'Commit to GitHub' }}
        </h2>
        <button
          ref="firstControlRef"
          type="button"
          class="btn btn-ghost btn-sm btn-square"
          aria-label="Close commit dialog"
          @click="commitDialogClosed()"
        >
          <XMarkIcon class="h-4 w-4" />
        </button>
      </div>

      <p v-if="targetPath !== ''" class="mt-1 truncate text-xs text-base-content/60">
        {{ targetPath }}
      </p>

      <!-- Conflict: three explicit choices, none pre-selected. -->
      <div v-if="inConflict" class="mt-4 flex flex-col gap-3">
        <p class="text-sm text-base-content/70">
          This file changed on GitHub since it was opened, so it wasn't committed. Choose how to
          resolve it:
        </p>
        <div class="flex flex-col gap-2">
          <button
            type="button"
            class="btn btn-sm btn-block flex-col items-start gap-0 py-1 text-left normal-case"
            @click="conflictOverwriteRequested()"
          >
            <span class="text-sm font-medium text-base-content">Overwrite remote</span>
            <span class="text-xs font-normal text-base-content/60">
              Commit your version on top of the newer remote one.
            </span>
          </button>
          <button
            type="button"
            class="btn btn-sm btn-block flex-col items-start gap-0 py-1 text-left normal-case"
            @click="conflictKeepLocalRequested()"
          >
            <span class="text-sm font-medium text-base-content">Keep local only</span>
            <span class="text-xs font-normal text-base-content/60">
              Don't commit; leave your local copy as it is.
            </span>
          </button>
          <button
            type="button"
            class="btn btn-sm btn-block flex-col items-start gap-0 py-1 text-left normal-case"
            @click="conflictReloadRemoteRequested()"
          >
            <span class="text-sm font-medium text-base-content">Reload remote, discard local</span>
            <span class="text-xs font-normal text-base-content/60">
              Replace your local edits with the version now on GitHub.
            </span>
          </button>
        </div>
      </div>

      <!-- Normal: commit message + button. -->
      <form v-else class="mt-4 flex flex-col gap-3" @submit.prevent="submit">
        <label class="flex flex-col gap-1">
          <span class="text-sm text-base-content">Commit message</span>
          <input
            v-model="message"
            type="text"
            class="input input-sm w-full"
            aria-label="Commit message"
            :disabled="committing"
          />
        </label>
        <p v-if="status === 'error' && error !== null" class="text-xs" :style="errorInk">
          {{ error }}
        </p>
        <div class="flex justify-end gap-2">
          <button type="button" class="btn btn-ghost btn-sm" @click="commitDialogClosed()">
            Cancel
          </button>
          <button
            type="submit"
            class="btn btn-primary btn-sm"
            :disabled="committing || message.trim() === ''"
          >
            <span
              v-if="committing"
              class="loading loading-spinner loading-xs"
              aria-hidden="true"
            ></span>
            {{ committing ? 'Committing…' : 'Commit' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

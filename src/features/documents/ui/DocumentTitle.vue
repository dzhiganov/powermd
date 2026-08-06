<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useUnit } from 'effector-vue/composition'

import { $activeDocument, $folders, $saveStatus, documentRenamed } from '../model/documents'

// See `DrawerToggleButton.vue` for why this is a prop rather than a direct
// `@/features/settings` import.
defineProps<{ showTooltips?: boolean }>()

const active = useUnit($activeDocument)
const folders = useUnit($folders)
const saveStatus = useUnit($saveStatus)

// Header breadcrumb (Phase 2 visual redesign, revised — user request): folder
// name, a `/` separator, then the document title — `DocumentTitle` already
// owned the title + its rename interaction, so the breadcrumb is built here
// rather than in a new component, keeping rename a single source of truth.
// A root-level document (`folderId === null`) — or one whose folder id no
// longer resolves, same defensive "can't show a folder that isn't there"
// case — now resolves to `null` rather than the literal string "Unfiled":
// the template below renders neither the folder segment nor the `/`
// separator when this is `null`, so a root document's header reads as just
// its title, with no dangling label or separator. A foldered document is
// unaffected — it still reads `Folder / Title`.
const folderName = computed<string | null>(() => {
  const doc = active.value
  if (doc === null || doc.folderId === null) return null
  return folders.value.find((folder) => folder.id === doc.folderId)?.name ?? null
})

// The unsaved dot: pending/saving shows it, saved hides it. A save
// *failure* deliberately does NOT show here — collapsing an error down to
// "just a dot" is exactly what the redesign must avoid; a failure instead
// keeps the stronger, persistent, non-auto-hiding affordance in
// `SaveIndicator.vue` (rendered separately, see `AppShell.vue`). This
// replaces the old transient corner "saving/saved" flash for those two
// states; the corner indicator's accessible live-region announcement
// (`aria-live="polite"`) still fires for every state, dot or not.
const showUnsavedDot = computed(() => saveStatus.value === 'unsaved')

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
  <div class="flex min-w-0 items-baseline gap-2">
    <!-- `--md-t3`/`--md-t4` here are exactly the "small secondary label"
         case they're safe for (13px breadcrumb chrome, not running text) —
         see `app/styles/main.css`'s contrast-limitation note on those two
         tokens. Falls back to `base-content` if the custom property is ever
         unset, same defensive fallback pattern the reference design itself
         uses. Both the folder label and its `/` separator are gated behind
         `folderName !== null` as one unit — a root-level document renders
         neither (just the title below), not a dangling separator with
         nothing in front of it. -->
    <template v-if="folderName !== null">
      <span
        class="shrink-0 truncate text-[13px]"
        style="color: var(--md-t3, var(--color-base-content))"
      >
        {{ folderName }}
      </span>
      <span
        class="shrink-0 text-[13px]"
        style="color: var(--md-t4, var(--color-base-content))"
        aria-hidden="true"
        >/</span
      >
    </template>

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
      class="btn btn-ghost btn-sm min-w-0 max-w-[10rem] justify-start truncate px-1.5 font-medium sm:max-w-[16rem]"
      aria-label="Rename document"
      :title="showTooltips ? 'Rename document' : undefined"
      @click="startRename"
    >
      {{ active?.title || 'Untitled' }}
    </button>

    <span
      v-if="showUnsavedDot"
      class="h-[5px] w-[5px] shrink-0 rounded-full"
      style="background: var(--md-accent)"
      title="Unsaved changes"
      aria-hidden="true"
    />
  </div>
</template>

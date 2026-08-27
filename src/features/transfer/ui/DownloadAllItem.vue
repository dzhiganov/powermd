<script setup lang="ts">
/**
 * "Download all" — every document and folder as one `.zip`.
 *
 * Sits in the "…" menu's FIRST section, next to Import, rather than in the
 * export section below it. Everything under that section's heading acts on
 * the document you currently have open ("Markdown (.md)" exports one file,
 * not all of them); this acts on the whole workspace, and Import is its
 * natural pair — one brings documents in, the other takes them all out.
 * Putting it among the per-document exports would make "Markdown (.md)"
 * directly above it read as ambiguous.
 */
import { ArchiveBoxArrowDownIcon } from '@heroicons/vue/24/outline'

import { downloadAllRequested } from '../model/transfer'

const props = defineProps<{
  /** The owning popover's `close`. */
  close: () => void
}>()

function handleClick(): void {
  downloadAllRequested()
  props.close()
}
</script>

<template>
  <button type="button" role="menuitem" class="popover-menu-item" @click="handleClick">
    <ArchiveBoxArrowDownIcon class="h-3.5 w-3.5 shrink-0" />
    Download all (.zip)
  </button>
</template>

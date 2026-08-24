<script setup lang="ts">
import { computed } from 'vue'
import {
  ArrowDownTrayIcon,
  DocumentIcon,
  CodeBracketIcon,
  PrinterIcon,
  ClipboardDocumentIcon,
  ClipboardDocumentCheckIcon,
} from '@heroicons/vue/24/outline'
import { useUnit } from 'effector-vue/composition'

import { $showTooltips } from '@/features/settings'
import PopoverMenu from '@/shared/ui/PopoverMenu.vue'

import {
  exportMarkdownRequested,
  exportHtmlRequested,
  exportPdfRequested,
  copyMarkdownRequested,
  copyHtmlRequested,
} from '../model/transfer'

// `side` is the documents panel's dock side, threaded down from
// `AppShell.vue` — this menu sits in that panel's tools row, which mirrors
// with it, so the panel must open away from whichever window edge the row
// is against. See `PopoverMenu`'s `align` prop.
const props = withDefaults(defineProps<{ side?: 'left' | 'right' }>(), { side: 'right' })

const menuAlign = computed(() => (props.side === 'left' ? 'start' : 'end'))

const showTooltips = useUnit($showTooltips)

// Used to be daisyUI's CSS-only `:focus-within` dropdown — no Escape
// handling, no focus trap, and it closed by blurring the focused item
// rather than by an actual open/closed state. It's `PopoverMenu`
// (`@/shared/ui/PopoverMenu.vue`) now, the same shared implementation
// every other popover in the app uses: outside-click dismissal, Escape
// closes and returns focus to the trigger, and a real Tab-trap while open.
function handleExportMarkdown(close: () => void): void {
  exportMarkdownRequested()
  close()
}
function handleExportHtml(close: () => void): void {
  exportHtmlRequested()
  close()
}
function handleExportPdf(close: () => void): void {
  exportPdfRequested()
  close()
}
function handleCopyMarkdown(close: () => void): void {
  copyMarkdownRequested()
  close()
}
function handleCopyHtml(close: () => void): void {
  copyHtmlRequested()
  close()
}
</script>

<template>
  <PopoverMenu
    class="print:hidden"
    label="Export document"
    :align="menuAlign"
    width="256px"
    :z-index="70"
  >
    <template #trigger="{ open, toggle, setTriggerRef }">
      <button
        :ref="setTriggerRef"
        type="button"
        class="btn btn-ghost btn-xs btn-square"
        aria-label="Export document"
        aria-haspopup="menu"
        :aria-expanded="open"
        :title="showTooltips ? 'Export' : undefined"
        @click="toggle"
      >
        <ArrowDownTrayIcon class="h-3.5 w-3.5" />
      </button>
    </template>

    <template #default="{ close, setFirstItemRef }">
      <button
        :ref="setFirstItemRef"
        type="button"
        role="menuitem"
        class="popover-menu-item"
        @click="handleExportMarkdown(close)"
      >
        <DocumentIcon class="h-3.5 w-3.5 shrink-0" /> Markdown (.md)
      </button>
      <button
        type="button"
        role="menuitem"
        class="popover-menu-item"
        @click="handleExportHtml(close)"
      >
        <CodeBracketIcon class="h-3.5 w-3.5 shrink-0" /> Styled HTML (.html)
      </button>
      <button
        type="button"
        role="menuitem"
        class="popover-menu-item"
        @click="handleExportPdf(close)"
      >
        <PrinterIcon class="h-3.5 w-3.5 shrink-0" /> Print / PDF
      </button>
      <div class="popover-menu-heading">Copy</div>
      <button
        type="button"
        role="menuitem"
        class="popover-menu-item"
        @click="handleCopyMarkdown(close)"
      >
        <ClipboardDocumentIcon class="h-3.5 w-3.5 shrink-0" /> Copy Markdown
      </button>
      <button
        type="button"
        role="menuitem"
        class="popover-menu-item"
        @click="handleCopyHtml(close)"
      >
        <ClipboardDocumentCheckIcon class="h-3.5 w-3.5 shrink-0" /> Copy rendered HTML
      </button>
    </template>
  </PopoverMenu>
</template>

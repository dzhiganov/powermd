<script setup lang="ts">
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

import {
  exportMarkdownRequested,
  exportHtmlRequested,
  exportPdfRequested,
  copyMarkdownRequested,
  copyHtmlRequested,
} from '../model/transfer'

const showTooltips = useUnit($showTooltips)

// daisyUI's dropdown is CSS-only (`:focus-within`), so the only JS needed
// is closing it after a choice is made — blurring the currently-focused
// menu item is what actually closes a `:focus-within` dropdown, and needs
// no open/closed store of its own.
function closeMenu(): void {
  ;(document.activeElement as HTMLElement | null)?.blur()
}

function handleExportMarkdown(): void {
  exportMarkdownRequested()
  closeMenu()
}
function handleExportHtml(): void {
  exportHtmlRequested()
  closeMenu()
}
function handleExportPdf(): void {
  exportPdfRequested()
  closeMenu()
}
function handleCopyMarkdown(): void {
  copyMarkdownRequested()
  closeMenu()
}
function handleCopyHtml(): void {
  copyHtmlRequested()
  closeMenu()
}
</script>

<template>
  <div class="dropdown dropdown-end print:hidden">
    <button
      type="button"
      tabindex="0"
      class="btn btn-ghost btn-sm btn-square"
      aria-label="Export document"
      :title="showTooltips ? 'Export' : undefined"
    >
      <ArrowDownTrayIcon class="h-4 w-4" />
    </button>
    <ul
      tabindex="0"
      class="menu dropdown-content z-[70] w-64 gap-0.5 rounded-box bg-base-200 p-2 shadow-xl"
    >
      <li>
        <button type="button" @click="handleExportMarkdown">
          <DocumentIcon class="h-4 w-4" /> Markdown (.md)
        </button>
      </li>
      <li>
        <button type="button" @click="handleExportHtml">
          <CodeBracketIcon class="h-4 w-4" /> Styled HTML (.html)
        </button>
      </li>
      <li>
        <button type="button" @click="handleExportPdf">
          <PrinterIcon class="h-4 w-4" /> Print / PDF
        </button>
      </li>
      <li class="menu-title mt-1 px-2 text-xs">Copy</li>
      <li>
        <button type="button" @click="handleCopyMarkdown">
          <ClipboardDocumentIcon class="h-4 w-4" /> Copy Markdown
        </button>
      </li>
      <li>
        <button type="button" @click="handleCopyHtml">
          <ClipboardDocumentCheckIcon class="h-4 w-4" /> Copy rendered HTML
        </button>
      </li>
    </ul>
  </div>
</template>

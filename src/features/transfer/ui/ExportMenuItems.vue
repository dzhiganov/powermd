<script setup lang="ts">
/**
 * The export actions as bare `popover-menu-item` rows, with no popover of
 * their own.
 *
 * This used to be `ExportMenu.vue` — the same five actions plus their own
 * trigger button and `PopoverMenu` wrapper, sitting in the documents panel's
 * tools row. That row is gone (user request: theme, import and export all
 * moved into the "…" menu), so what is left is only the items, rendered
 * inside `layout/ui/MoreMenu.vue`'s popover alongside import, the theme
 * switcher, and settings.
 *
 * Kept in `transfer` rather than inlined into `MoreMenu.vue` so the export
 * actions still live in the feature that owns them — `layout` gets to
 * compose the menu without also owning what each export item does, and a
 * second mounting site (a future toolbar, a context menu) can render the
 * same five rows without copying them.
 *
 * Every handler closes the menu, because every one of these either starts a
 * download, opens the print dialog, or writes the clipboard — all of which
 * are terminal actions that leave nothing to come back to the menu for.
 * (`ThemeToggle.vue`'s theme switcher is the deliberate exception; see its
 * comment.)
 */
import {
  DocumentIcon,
  CodeBracketIcon,
  PrinterIcon,
  ClipboardDocumentIcon,
  ClipboardDocumentCheckIcon,
} from '@heroicons/vue/24/outline'

import {
  exportMarkdownRequested,
  exportHtmlRequested,
  exportPdfRequested,
  copyMarkdownRequested,
  copyHtmlRequested,
} from '../model/transfer'

const props = defineProps<{
  /** The owning popover's `close` — see the note above on why every item
   * here calls it. */
  close: () => void
}>()

function run(action: () => void): void {
  action()
  props.close()
}
</script>

<template>
  <button
    type="button"
    role="menuitem"
    class="popover-menu-item"
    @click="run(exportMarkdownRequested)"
  >
    <DocumentIcon class="h-3.5 w-3.5 shrink-0" />
    Markdown (.md)
  </button>
  <button type="button" role="menuitem" class="popover-menu-item" @click="run(exportHtmlRequested)">
    <CodeBracketIcon class="h-3.5 w-3.5 shrink-0" />
    Styled HTML (.html)
  </button>
  <button type="button" role="menuitem" class="popover-menu-item" @click="run(exportPdfRequested)">
    <PrinterIcon class="h-3.5 w-3.5 shrink-0" />
    Print / PDF
  </button>
  <div class="popover-menu-heading">Copy</div>
  <button
    type="button"
    role="menuitem"
    class="popover-menu-item"
    @click="run(copyMarkdownRequested)"
  >
    <ClipboardDocumentIcon class="h-3.5 w-3.5 shrink-0" />
    Copy Markdown
  </button>
  <button type="button" role="menuitem" class="popover-menu-item" @click="run(copyHtmlRequested)">
    <ClipboardDocumentCheckIcon class="h-3.5 w-3.5 shrink-0" />
    Copy rendered HTML
  </button>
</template>

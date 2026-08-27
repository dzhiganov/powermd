<script setup lang="ts">
import { computed } from 'vue'
import {
  EllipsisHorizontalIcon,
  Cog6ToothIcon,
  QuestionMarkCircleIcon,
  InformationCircleIcon,
} from '@heroicons/vue/24/outline'

import PopoverMenu from '@/shared/ui/PopoverMenu.vue'
import { settingsOpened, helpOpened, ThemeToggle } from '@/features/settings'
import { ImportButton, ExportMenuItems, DownloadAllItem } from '@/features/transfer'

import { aboutOpened } from '../model/dialogs'

// `showTooltips` comes in as a prop rather than a direct
// `@/features/settings` import for the tooltip text specifically — this
// component already imports `settings`' *events* directly above (same as
// `Toolbar.vue`, its only mounting site, already does for several other
// features), so this is purely about keeping the prop-threading pattern
// consistent with the rest of the header rather than a hard boundary rule.
// `side` is the documents panel's dock side, threaded down from
// `AppShell.vue`. This menu lives in that panel's tools row, which mirrors
// with it — so the panel has to open away from whichever window edge the
// row is sitting against, or it renders off-screen. See `PopoverMenu`'s
// `align` prop for the fuller note.
const props = withDefaults(defineProps<{ showTooltips?: boolean; side?: 'left' | 'right' }>(), {
  showTooltips: false,
  side: 'right',
})

const menuAlign = computed(() => (props.side === 'left' ? 'start' : 'end'))

// Open/close state, outside-click dismissal, Escape-returns-focus, and the
// Tab-trap all now live in `PopoverMenu` (`@/shared/ui/PopoverMenu.vue`) —
// this component only supplies the trigger button and the three items.
// `z-index: 70` matches this menu's pre-`PopoverMenu` value: it has to
// clear the mobile drawer backdrop (`DocumentDrawer.vue`, `z-40`).
function handleSettings(close: () => void): void {
  close()
  settingsOpened(undefined)
}

function handleShortcuts(close: () => void): void {
  close()
  helpOpened()
}

function handleAbout(close: () => void): void {
  close()
  aboutOpened()
}
</script>

<template>
  <!-- 256px, up from 208px: the export rows ("Styled HTML (.html)", "Copy
       rendered HTML") are the widest labels in the app's menus, and every
       `popover-menu-item` is `white-space: nowrap`. This is the width
       `ExportMenu.vue` already used for the same five rows. -->
  <PopoverMenu label="More actions" :align="menuAlign" width="256px" :z-index="70">
    <template #trigger="{ open, toggle, setTriggerRef }">
      <button
        :ref="setTriggerRef"
        type="button"
        class="btn btn-ghost btn-xs btn-square"
        aria-label="More actions"
        aria-haspopup="menu"
        :aria-expanded="open"
        :title="showTooltips ? 'More' : undefined"
        @click="toggle"
      >
        <EllipsisHorizontalIcon class="h-3.5 w-3.5" />
      </button>
    </template>

    <!-- THE app's tools menu. The documents panel's tools row used to hold
         four separate controls — a theme cycle button, an import button, an
         export popover and this one; the user asked for all of them behind
         the "…", so that row is now a single trigger and this menu owns
         everything it used to sit next to.
         Three sections, divided: what you do to the APP (theme, import),
         what you do to THIS DOCUMENT (export/copy), and where you go
         (settings, shortcuts, about).
         The theme, import and export rows are components owned by the
         features they belong to (`settings`, `transfer`) rather than markup
         written here — `layout` composes the menu, it does not own what the
         rows do. -->
    <template #default="{ close, setFirstItemRef }">
      <!-- `setFirstItemRef` moves with the first row, whatever it is — this
           is the element `PopoverMenu` focuses the instant the menu opens. -->
      <ThemeToggle :ref="setFirstItemRef" menu-item />
      <ImportButton menu-item @picked="close" />
      <DownloadAllItem :close="close" />

      <!-- "This document", not "Export": "Download all (.zip)" directly
           above is an export too, so a heading that only said "Export"
           would read as covering it — and then "Markdown (.md)" below,
           which exports the OPEN document alone, becomes ambiguous. The
           heading now says what the section is scoped to instead of what it
           does. -->
      <div class="popover-menu-divider" />
      <div class="popover-menu-heading">This document</div>
      <ExportMenuItems :close="close" />

      <div class="popover-menu-divider" />
      <button
        type="button"
        role="menuitem"
        class="popover-menu-item"
        @click="handleSettings(close)"
      >
        <Cog6ToothIcon class="h-3.5 w-3.5 shrink-0" />
        Settings
      </button>
      <button
        type="button"
        role="menuitem"
        class="popover-menu-item"
        @click="handleShortcuts(close)"
      >
        <QuestionMarkCircleIcon class="h-3.5 w-3.5 shrink-0" />
        Keyboard shortcuts
      </button>
      <button type="button" role="menuitem" class="popover-menu-item" @click="handleAbout(close)">
        <InformationCircleIcon class="h-3.5 w-3.5 shrink-0" />
        About
      </button>
    </template>
  </PopoverMenu>
</template>

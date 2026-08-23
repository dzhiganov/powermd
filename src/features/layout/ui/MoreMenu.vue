<script setup lang="ts">
import {
  EllipsisHorizontalIcon,
  Cog6ToothIcon,
  QuestionMarkCircleIcon,
  InformationCircleIcon,
} from '@heroicons/vue/24/outline'

import PopoverMenu from '@/shared/ui/PopoverMenu.vue'
import { settingsOpened, helpOpened } from '@/features/settings'

import { aboutOpened } from '../model/dialogs'

// `showTooltips` comes in as a prop rather than a direct
// `@/features/settings` import for the tooltip text specifically — this
// component already imports `settings`' *events* directly above (same as
// `Toolbar.vue`, its only mounting site, already does for several other
// features), so this is purely about keeping the prop-threading pattern
// consistent with the rest of the header rather than a hard boundary rule.
withDefaults(defineProps<{ showTooltips?: boolean }>(), { showTooltips: false })

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
  <PopoverMenu label="More actions" align="end" width="208px" :z-index="70">
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

    <!-- Import, Print, and GitHub sync used to live here too — all
         removed (user request): Import duplicated the toolbar's own
         `ImportButton` (`Toolbar.vue`, plain icon-button variant, added
         alongside `ExportMenu`), Print duplicated `ExportMenu`'s own
         "Print / PDF" entry, and GitHub sync's connection UI moved into
         Settings' own "GitHub sync" category (see
         `features/github/ui/GitHubSyncPanel.vue`) — `SyncStatusIndicator`
         in `Toolbar.vue` and this menu's own "Settings" item are both
         already sufficient ways to reach it, so a third, GitHub-specific
         entry here would just be redundant. None of the three features
         were removed, only this second entry point onto each —
         `ImportButton.vue`'s `menuItem` prop variant this popover used to
         render stays in that component for the toolbar-vs-menu-item shape
         switch, even though nothing here uses it anymore. -->
    <template #default="{ close, setFirstItemRef }">
      <button
        :ref="setFirstItemRef"
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

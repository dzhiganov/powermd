<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import {
  EllipsisHorizontalIcon,
  Cog6ToothIcon,
  QuestionMarkCircleIcon,
  InformationCircleIcon,
} from '@heroicons/vue/24/outline'

import { useDialogFocusTrap } from '@/shared/lib/useDialog'
import { settingsOpened, helpOpened } from '@/features/settings'

import { aboutOpened } from '../model/dialogs'

// `showTooltips` comes in as a prop rather than a direct
// `@/features/settings` import for the tooltip text specifically — this
// component already imports `settings`' *events* directly above (same as
// `Toolbar.vue`, its only mounting site, already does for several other
// features), so this is purely about keeping the prop-threading pattern
// consistent with the rest of the header rather than a hard boundary rule.
withDefaults(defineProps<{ showTooltips?: boolean }>(), { showTooltips: false })

// Popover open state — local UI state, not a global store (same shape as
// `DocumentRow.vue`'s per-row actions menu it's modelled on). Unlike that
// menu, this one uses `useDialogFocusTrap` for the Tab-wrap-within-the-
// popover and focus-returns-to-trigger-on-close behaviour — the task calls
// for a genuine keyboard-operable focus trap here, not just
// dismiss-on-outside-click.
const open = ref(false)
const menuRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)
// The menu's first item ("Settings") is a plain `<button>` now that neither
// Import nor GitHub sync occupies that slot (see the removed-entries note
// near the template below), so this can be a direct template ref — the hook
// itself already focuses it on open, no separate querySelector workaround
// needed.
const firstItemRef = ref<HTMLButtonElement | null>(null)

const { trapFocus } = useDialogFocusTrap(menuRef, open, firstItemRef)

function toggleMenu() {
  open.value = !open.value
}

function closeMenu() {
  open.value = false
}

function handleOutsideClick(event: MouseEvent) {
  const target = event.target as Node | null
  if (target === null) return
  if (menuRef.value?.contains(target) === true) return
  if (triggerRef.value?.contains(target) === true) return
  closeMenu()
}

watch(open, (isOpen) => {
  if (isOpen) {
    document.addEventListener('click', handleOutsideClick, true)
  } else {
    document.removeEventListener('click', handleOutsideClick, true)
  }
})
onBeforeUnmount(() => document.removeEventListener('click', handleOutsideClick, true))

function handleSettings() {
  closeMenu()
  settingsOpened(undefined)
}

function handleShortcuts() {
  closeMenu()
  helpOpened()
}

function handleAbout() {
  closeMenu()
  aboutOpened()
}

function handleEscape() {
  closeMenu()
  triggerRef.value?.focus()
}
</script>

<template>
  <div class="relative">
    <button
      ref="triggerRef"
      type="button"
      class="btn btn-ghost btn-xs btn-square"
      aria-label="More actions"
      aria-haspopup="menu"
      :aria-expanded="open"
      :title="showTooltips ? 'More' : undefined"
      @click="toggleMenu"
    >
      <EllipsisHorizontalIcon class="h-3.5 w-3.5" />
    </button>

    <div
      v-if="open"
      ref="menuRef"
      role="menu"
      aria-label="More actions"
      class="more-menu"
      style="background: var(--md-pop, var(--color-base-100)); border-color: var(--color-base-300)"
      @keydown.esc="handleEscape"
      @keydown.tab="trapFocus"
    >
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
      <button
        ref="firstItemRef"
        type="button"
        role="menuitem"
        class="more-menu-item"
        @click="handleSettings"
      >
        <Cog6ToothIcon class="h-3.5 w-3.5 shrink-0" />
        Settings
      </button>
      <button type="button" role="menuitem" class="more-menu-item" @click="handleShortcuts">
        <QuestionMarkCircleIcon class="h-3.5 w-3.5 shrink-0" />
        Keyboard shortcuts
      </button>
      <button type="button" role="menuitem" class="more-menu-item" @click="handleAbout">
        <InformationCircleIcon class="h-3.5 w-3.5 shrink-0" />
        About
      </button>
    </div>
  </div>
</template>

<style scoped>
.more-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 70;
  width: 208px;
  padding: 5px;
  border: 1px solid;
  border-radius: 10px;
  box-shadow: 0 12px 32px rgb(0 0 0 / 40%);
}

.more-menu-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-base-content);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  text-align: left;
  white-space: nowrap;
}

.more-menu-item:hover,
.more-menu-item:focus-visible {
  background: var(--md-hov, var(--color-base-200));
}

.more-menu-item:focus-visible {
  outline: 2px solid var(--md-accent);
  outline-offset: -2px;
}
</style>

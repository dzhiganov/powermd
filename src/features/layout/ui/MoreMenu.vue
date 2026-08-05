<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  EllipsisHorizontalIcon,
  Cog6ToothIcon,
  QuestionMarkCircleIcon,
  PrinterIcon,
} from '@heroicons/vue/24/outline'

import { useDialogFocusTrap } from '@/shared/lib/useDialog'
import { settingsOpened, helpOpened } from '@/features/settings'
import { githubModalOpened } from '@/features/github'
import { ImportButton, exportPdfRequested } from '@/features/transfer'

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

// The hook's own "focus this on open" target wants a plain `HTMLElement`
// ref — the menu's first item is `ImportButton` (a component, rendered via
// its `menuItem` variant), and a template `ref` on a component resolves to
// the component instance, not a DOM node, so it can't be handed to the hook
// directly. Left permanently `null` (a harmless no-op for the hook) and
// handled explicitly below instead, by querying the popover's own first
// focusable element once it's actually in the DOM.
const noComponentFirstFocusRef = ref<HTMLElement | null>(null)

const { trapFocus } = useDialogFocusTrap(menuRef, open, noComponentFirstFocusRef)

watch(open, async (isOpen) => {
  if (!isOpen) return
  await nextTick()
  menuRef.value?.querySelector<HTMLElement>('button, [href], input, [tabindex]')?.focus()
})

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

function handleGithubSync() {
  closeMenu()
  githubModalOpened()
}

function handleSettings() {
  closeMenu()
  settingsOpened()
}

function handleShortcuts() {
  closeMenu()
  helpOpened()
}

function handlePrint() {
  closeMenu()
  // Same event the Export menu's "Print / PDF" item fires — a quick-access
  // duplicate entry point onto the one export/print pipeline
  // (`features/transfer/model/transfer.ts`), not a second implementation.
  exportPdfRequested()
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
      <ImportButton menu-item @picked="closeMenu" />
      <button type="button" role="menuitem" class="more-menu-item" @click="handleGithubSync">
        <svg
          viewBox="0 0 16 16"
          class="h-3.5 w-3.5 shrink-0"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"
          />
        </svg>
        GitHub sync
      </button>
      <button type="button" role="menuitem" class="more-menu-item" @click="handleSettings">
        <Cog6ToothIcon class="h-3.5 w-3.5 shrink-0" />
        Settings
      </button>
      <button type="button" role="menuitem" class="more-menu-item" @click="handleShortcuts">
        <QuestionMarkCircleIcon class="h-3.5 w-3.5 shrink-0" />
        Keyboard shortcuts
      </button>
      <div class="more-menu-sep" style="background: var(--color-base-300)" role="none" />
      <button type="button" role="menuitem" class="more-menu-item" @click="handlePrint">
        <PrinterIcon class="h-3.5 w-3.5 shrink-0" />
        Print
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
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}

.more-menu-sep {
  height: 1px;
  margin: 5px 0;
}
</style>

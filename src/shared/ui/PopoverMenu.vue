<script setup lang="ts">
/**
 * Shared popover-menu shell — the single implementation behind every
 * dismissible menu in the app: the header's "More actions" menu, the
 * documents drawer's "New" menu, each document/folder row's "…" menu, and
 * the export menu. Before this component existed, all four had drifted
 * into near-duplicate (or, for the export menu, entirely different)
 * hand-rolled variants of the same behaviour. This owns that behaviour
 * once:
 *
 *   - open/close state
 *   - outside-click dismissal
 *   - Escape closes the menu and returns focus to the trigger
 *   - `useDialogFocusTrap` for Tab-wrap-within-the-panel and
 *     auto-focusing the first item on open
 *   - `role="menu"` + `aria-label` wiring on the panel
 *
 * It deliberately does NOT own the trigger or the items: a primary
 * full-width button, a small ghost icon button, and an overflow "…"
 * button don't share enough markup to generalise, and neither do "New
 * file"/"New folder" vs. "Export as Markdown"/"Copy HTML" vs.
 * "Rename"/"Move to <folder>"/"Delete". Both are slots — the caller owns
 * `aria-haspopup="menu"` and (via the `trigger` slot's `open` binding)
 * `:aria-expanded` on its own trigger element, and every item's
 * `role="menuitem"`/label/icon/click-handler in the default slot.
 *
 * POSITIONING covers every caller without a per-caller special case:
 *   - `align="end"` (default): panel right-edge flush with the trigger's
 *     containing box, sized by `width`. Used by the header's "More
 *     actions" menu, every row's "…" menu, and the export menu.
 *   - `align="stretch"`: panel spans `left: 0; right: 0` of the
 *     containing box instead — it tracks the trigger's own width rather
 *     than a fixed one. Used by the documents drawer's full-width "New"
 *     button, where a fixed-width panel under a full-width trigger would
 *     look like a mistake.
 *
 * SURFACE: `--md-pop` background, `--color-base-300` border, `--md-shadow-
 * pop` shadow — the same trio `MoreMenu.vue` (this component's direct
 * ancestor) already used, now the one surface every popover in the app
 * shares, including the export menu, which used to be a visually distinct
 * daisyUI `bg-base-200`/`rounded-box`/`shadow-xl` dropdown.
 */
import { onBeforeUnmount, ref, watch, type ComponentPublicInstance } from 'vue'

import { useDialogFocusTrap } from '../lib/useDialog'

withDefaults(
  defineProps<{
    /** Accessible name for the `role="menu"` panel — normally the same
     * string as the trigger's own `aria-label`. */
    label: string
    /** `'end'` (default): right-aligned, sized by `width`. `'start'`:
     * left-aligned. `'stretch'`: spans the full width of the trigger's
     * containing box.
     *
     * `'start'` exists because a right-aligned panel grows leftward from
     * its trigger, and a trigger near the left edge of the window therefore
     * pushes its own panel off-screen. That is exactly what happened to the
     * tools in the documents panel once the panel could dock left: the
     * cluster mirrors to the left edge, the menus kept opening rightward-
     * anchored, and their contents were clipped by the window. Callers that
     * can end up near either edge pass whichever alignment opens inward. */
    align?: 'start' | 'end' | 'stretch'
    /** Panel width in `align="end"` mode (e.g. `'208px'`). Ignored in
     * `align="stretch"` mode, where the panel's width tracks the
     * trigger's containing box instead. Omitted, the panel shrinks to fit
     * its content (the browser's default for an absolutely positioned,
     * unsized block). */
    width?: string
    /** Gap between the trigger and the panel, in px. */
    offset?: number
    /** Stacking context for the panel — callers nested inside their own
     * positioned ancestors (row menus inside a scrollable list, the "New"
     * menu inside the drawer) only need to beat their own siblings, not
     * the whole app, so this varies per caller rather than sharing one
     * hardcoded value. */
    zIndex?: number
  }>(),
  { align: 'end', width: undefined, offset: 6, zIndex: 20 },
)

const open = ref(false)
const menuRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLElement | null>(null)
const firstItemRef = ref<HTMLElement | null>(null)

// Tab-wrap within the panel, auto-focus the first item on open, and focus
// return to the trigger whenever `open` flips back to false — regardless
// of *why* it closed (Escape, outside click, or an item's own handler
// calling `close()`), matching `MoreMenu.vue`'s existing behaviour.
const { trapFocus } = useDialogFocusTrap(menuRef, open, firstItemRef)

/** Passed to the caller's trigger element via `:ref="setTriggerRef"` in
 * the `trigger` slot — this is how the component learns which DOM node is
 * the trigger without owning that element itself. */
function setTriggerRef(el: Element | ComponentPublicInstance | null): void {
  triggerRef.value = el instanceof HTMLElement ? el : null
}

/** Passed to the caller's first item via `:ref="setFirstItemRef"` in the
 * default slot — the element `useDialogFocusTrap` focuses the instant the
 * panel opens. Optional: a caller with no naturally-first focusable item
 * can simply not bind it.
 *
 * Unwraps `$el` when the ref lands on a COMPONENT rather than a plain
 * element. `MoreMenu.vue`'s first row is `<ThemeToggle menu-item />`, and a
 * `:ref` on a component yields its `ComponentPublicInstance`, not an
 * `HTMLElement` — the old `el instanceof HTMLElement ? el : null` quietly
 * stored `null` for that case, which does not throw or warn anywhere. It
 * just means the panel opens with nothing focused, so the first Tab goes
 * somewhere unrelated and keyboard users lose the menu. Guarded again after
 * the unwrap because `$el` is a comment node for a component whose root is
 * `v-if`'d off, and a fragment root yields the first node of the fragment,
 * which need not be an element either. */
function setFirstItemRef(el: Element | ComponentPublicInstance | null): void {
  if (el instanceof HTMLElement) {
    firstItemRef.value = el
    return
  }
  const root = (el as ComponentPublicInstance | null)?.$el ?? null
  firstItemRef.value = root instanceof HTMLElement ? root : null
}

function toggle(): void {
  open.value = !open.value
}

function close(): void {
  open.value = false
}

function handleOutsideClick(event: MouseEvent): void {
  const target = event.target as Node | null
  if (target === null) return
  if (menuRef.value?.contains(target) === true) return
  if (triggerRef.value?.contains(target) === true) return
  close()
}

watch(open, (isOpen) => {
  if (isOpen) {
    document.addEventListener('click', handleOutsideClick, true)
  } else {
    document.removeEventListener('click', handleOutsideClick, true)
  }
})
onBeforeUnmount(() => document.removeEventListener('click', handleOutsideClick, true))

function handleEscape(): void {
  close()
  triggerRef.value?.focus()
}

// Exposed for the rare caller that needs to close the menu from outside an
// item click handler (none currently do, but `defineExpose` costs nothing
// and keeps this from needing a breaking API change later).
defineExpose({ close })
</script>

<template>
  <div class="relative">
    <slot
      name="trigger"
      :open="open"
      :toggle="toggle"
      :close="close"
      :set-trigger-ref="setTriggerRef"
    />

    <div
      v-if="open"
      ref="menuRef"
      role="menu"
      :aria-label="label"
      class="popover-menu-panel"
      :class="`popover-menu-panel--${align}`"
      :style="{
        top: `calc(100% + ${offset}px)`,
        zIndex,
        width: align === 'stretch' ? undefined : width,
      }"
      @keydown.esc="handleEscape"
      @keydown.tab="trapFocus"
    >
      <slot :close="close" :set-first-item-ref="setFirstItemRef" />
    </div>
  </div>
</template>

<style scoped>
/*
 * ONE POPOVER SURFACE — `--md-pop`/`--color-base-300`/`--md-shadow-pop`,
 * square (10px panel radius, 6px per-item radius), flat (no gradient/inset
 * highlight). This is `MoreMenu.vue`'s pre-existing treatment, now shared
 * by every popover in the app, including the export menu (previously a
 * visually distinct daisyUI `bg-base-200`/`rounded-box`/`shadow-xl`
 * dropdown) and the row "…" menus (previously daisyUI `.menu`/
 * `rounded-box`/`shadow-lg`).
 */
.popover-menu-panel {
  position: absolute;
  z-index: 20;
  padding: 5px;
  border: 1px solid var(--color-base-300);
  border-radius: 10px;
  background: var(--md-pop, var(--color-base-100));
  box-shadow: var(--md-shadow-pop, 0 12px 32px rgb(0 0 0 / 40%));
}

.popover-menu-panel--end {
  right: 0;
}

.popover-menu-panel--start {
  left: 0;
}

.popover-menu-panel--stretch {
  left: 0;
  right: 0;
}

/*
 * `.popover-menu-item` / `-heading` / `-divider` are NOT here. They live in
 * `app/styles/main.css` as plain global classes.
 *
 * They used to live here as `:slotted()` rules, which was correct while
 * every item was a raw `<button>` written directly in a caller's default
 * slot. It stopped being enough once items started coming from nested
 * COMPONENTS instead (`transfer`'s `ImportButton`/`ExportMenuItems`,
 * `settings`' `ThemeToggle`, all rendered inside `layout/ui/MoreMenu.vue`'s
 * slot): `:slotted()` reaches the slot content's own root elements, not
 * markup rendered one component deeper, so those three would each have
 * needed a private copy of the block. `ImportButton.vue` already carried
 * exactly such a copy, under `.more-menu-item`, with a comment explaining
 * it could not reach these rules — that duplication is what the move
 * deletes.
 */
</style>

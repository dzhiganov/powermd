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
 * (there is none among the current menus) can simply not bind it. */
function setFirstItemRef(el: Element | ComponentPublicInstance | null): void {
  firstItemRef.value = el instanceof HTMLElement ? el : null
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
 * `:slotted()` — every item, heading, and divider below lives in the
 * caller's own template (passed in via the default slot), not this
 * component's. Vue's `scoped` attribute normally only reaches elements
 * this component renders itself; `:slotted()` is the documented escape
 * hatch for styling slot content from the child that owns the slot, which
 * is what lets one shared class name style items across five different
 * callers instead of each caller duplicating this block in its own
 * `<style scoped>` (which is exactly the drift this component exists to
 * end — `MoreMenu.vue` and `DocumentDrawer.vue` used to carry
 * byte-for-byte copies of it under `.more-menu-item`/`.new-menu-item`).
 */
:slotted(.popover-menu-item) {
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

:slotted(.popover-menu-item:hover),
:slotted(.popover-menu-item:focus-visible) {
  background: var(--md-hov, var(--color-base-200));
}

:slotted(.popover-menu-item:focus-visible) {
  outline: 2px solid var(--md-accent);
  outline-offset: -2px;
}

/* Disabled items (e.g. a row's own current folder in its "Move to" list)
 * are exempt from WCAG text-contrast floors — dimming is the affordance,
 * not a bug — see the `:disabled` state note in the migration report. */
:slotted(.popover-menu-item:disabled) {
  cursor: not-allowed;
  opacity: 0.45;
}

/* Destructive items (a row's "Delete") — same `--color-error` role
 * daisyUI's `text-error` already resolved to before this component
 * existed, just applied directly rather than through that utility class. */
:slotted(.popover-menu-item--danger) {
  color: var(--color-error);
}

/* Non-interactive section heading (the export menu's "Copy", a row's own
 * "Move to") — kept out of the tab order by construction: it's a `<div>`/
 * `<span>` with no `tabindex`, `href`, or form-control semantics, so
 * nothing here needs an explicit `tabindex="-1"` to achieve that. Full-
 * strength `--color-base-content` (not a muted `--md-t3`/`--md-t4` token)
 * for its text colour — those two tokens are documented in this file's
 * `KNOWN CONTRAST LIMITATIONS` block as unsafe for small text against
 * these surfaces; the muted *look* instead comes from size/weight/tracking
 * only, which costs nothing in contrast. */
:slotted(.popover-menu-heading) {
  padding: 8px 10px 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-base-content);
}

:slotted(.popover-menu-divider) {
  height: 1px;
  margin: 4px 6px;
  background: var(--color-base-300);
}
</style>

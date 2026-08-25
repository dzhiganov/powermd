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
import { computed, onBeforeUnmount, ref, watch, type ComponentPublicInstance } from 'vue'

import { useDialogFocusTrap } from '../lib/useDialog'

const props = withDefaults(
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
    /** `'below'` (default): panel opens downward from the trigger
     * (`top: calc(100% + offset)`) — right for every existing caller so
     * far, all header/toolbar-row triggers with room below them.
     * `'above'`: panel opens upward instead (`bottom: calc(100% + offset)`)
     * — for a trigger that sits at the BOTTOM of the viewport (the status
     * bar's `BookmarksIndicator.vue`), a downward-opening panel would
     * render partly or entirely below the viewport edge, unreachable by
     * mouse or keyboard alike. */
    placement?: 'below' | 'above'
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
  { align: 'end', placement: 'below', width: undefined, offset: 6, zIndex: 20 },
)

// Named `isOpen` internally (not `open`) so it doesn't collide with the
// exposed `open()` method below — the template still passes it to the
// trigger slot AS `open` (`:open="isOpen"`), which is the public slot-prop
// name every existing caller (`DocumentRow.vue`, etc.) already destructures
// — only this internal variable's own name changed.
const isOpen = ref(false)
const menuRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLElement | null>(null)
const firstItemRef = ref<HTMLElement | null>(null)

// Tab-wrap within the panel, auto-focus the first item on open, and focus
// return to the trigger whenever `isOpen` flips back to false — regardless
// of *why* it closed (Escape, outside click, or an item's own handler
// calling `close()`), matching `MoreMenu.vue`'s existing behaviour.
const { trapFocus } = useDialogFocusTrap(menuRef, isOpen, firstItemRef)

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
  isOpen.value = !isOpen.value
}

function close(): void {
  isOpen.value = false
}

function handleOutsideClick(event: MouseEvent): void {
  const target = event.target as Node | null
  if (target === null) return
  if (menuRef.value?.contains(target) === true) return
  if (triggerRef.value?.contains(target) === true) return
  close()
}

// --- `placement="above"`: escaping an `overflow: hidden` ancestor ---------
//
// `placement="below"` (every caller before `BookmarksIndicator.vue`) needs
// none of this: the panel is `position: absolute` inside this component's
// own `.relative` wrapper, and every existing trigger already has enough
// room below it within its own (non-clipping) ancestors.
//
// `BookmarksIndicator.vue`'s trigger lives inside `StatusBar.vue`'s
// `<footer class="... overflow-hidden ...">` — that `overflow-hidden` is
// load-bearing there (keeps the status row to one line, see that
// component's own comment), so it can't just be removed. But it also means
// an `absolute`-positioned panel, however it's positioned, gets its visual
// overflow clipped to the footer's own ~32px-tall box — verified while
// building this: the panel's content was geometrically "positioned"
// correctly but rendered invisible/unclickable beyond that clipped box.
// `position: fixed` + `Teleport to="body"` is the standard escape hatch:
// once the panel is a direct child of `<body>`, no ancestor's
// `overflow: hidden` applies to it at all, and `position: fixed` measures
// against the viewport instead of a clipped local containing block.
// `Teleport`'s own `disabled` prop keeps `placement="below"` callers on the
// exact unchanged `position: absolute`-in-place behaviour they already
// had — this whole mechanism only activates for `placement="above"`.
const fixedTriggerRect = ref<DOMRect | null>(null)

function measureFixedPosition(): void {
  fixedTriggerRect.value = triggerRef.value?.getBoundingClientRect() ?? null
}

const panelStyle = computed(() => {
  if (props.placement === 'above' && fixedTriggerRect.value !== null) {
    const rect = fixedTriggerRect.value
    // Always resolved to a `left` (never `right`) and CLAMPED into the
    // viewport, not just mirrored from `align` the way `placement="below"`
    // does with plain CSS `right: 0`/`left: 0`. `BookmarksIndicator.vue`'s
    // status-bar trigger is a genuine case that plain `align="end"` gets
    // wrong here: the status bar packs its content to whichever side is
    // OPPOSITE the docked drawer (`StatusBar.vue`'s own `justify-start`/
    // `-end`), which can leave the trigger sitting well away from either
    // screen edge — a fixed-width panel simply right-aligned to it (as
    // `align="end"` would do) can run off the LEFT edge of the viewport
    // instead, measured while building this: `right: 1098px` on a 1280px
    // viewport with a 300px panel put its `left` at -118px, entirely
    // off-screen and unclickable. Clamping is what floating-ui-style
    // libraries do for exactly this "trigger can be anywhere" case.
    const panelWidthPx =
      props.align === 'stretch'
        ? rect.width
        : props.width !== undefined
          ? parseFloat(props.width)
          : rect.width
    const desiredLeft =
      props.align === 'start' || props.align === 'stretch' ? rect.left : rect.right - panelWidthPx
    const margin = 8
    const maxLeft = Math.max(window.innerWidth - panelWidthPx - margin, margin)
    const clampedLeft = Math.min(Math.max(desiredLeft, margin), maxLeft)
    return {
      position: 'fixed' as const,
      bottom: `${window.innerHeight - rect.top + props.offset}px`,
      left: `${clampedLeft}px`,
      width: props.align === 'stretch' ? `${rect.width}px` : props.width,
      zIndex: props.zIndex,
    }
  }
  return {
    top: props.placement === 'below' ? `calc(100% + ${props.offset}px)` : undefined,
    bottom: props.placement === 'above' ? `calc(100% + ${props.offset}px)` : undefined,
    zIndex: props.zIndex,
    width: props.align === 'stretch' ? undefined : props.width,
  }
})

watch(isOpen, (nowOpen) => {
  if (nowOpen) {
    document.addEventListener('click', handleOutsideClick, true)
    if (props.placement === 'above') {
      measureFixedPosition()
      window.addEventListener('resize', measureFixedPosition)
      window.addEventListener('scroll', measureFixedPosition, true)
    }
  } else {
    document.removeEventListener('click', handleOutsideClick, true)
    window.removeEventListener('resize', measureFixedPosition)
    window.removeEventListener('scroll', measureFixedPosition, true)
  }
})
onBeforeUnmount(() => {
  document.removeEventListener('click', handleOutsideClick, true)
  window.removeEventListener('resize', measureFixedPosition)
  window.removeEventListener('scroll', measureFixedPosition, true)
})

function handleEscape(): void {
  close()
  triggerRef.value?.focus()
}

// `close` — exposed for the rare caller that needs to close the menu from
// outside an item click handler (none currently do, but `defineExpose`
// costs nothing and keeps this from needing a breaking API change later).
//
// `open` — added for `documents/ui/BookmarksIndicator.vue`: a bookmark's
// gutter marker (owned by `editor`, a raw CodeMirror-rendered DOM button,
// never a Vue-managed element) has no `ref` this component's own `trigger`
// slot mechanism could bind as a normal trigger, so clicking one has to
// open THIS popover from the outside via its id — see that component's own
// doc comment for the full reasoning on why the marker click and the
// status-bar trigger share one popover instance rather than each getting
// its own. Every other caller still drives `open` purely through its own
// trigger slot and never needs this.
function open(): void {
  isOpen.value = true
}

defineExpose({ close, open })
</script>

<template>
  <div class="relative">
    <slot
      name="trigger"
      :open="isOpen"
      :toggle="toggle"
      :close="close"
      :set-trigger-ref="setTriggerRef"
    />

    <!-- See `panelStyle`'s own doc comment above for why `placement="above"`
         teleports to `<body>` (escaping `StatusBar.vue`'s clipping
         `overflow-hidden`) while `placement="below"` (every other caller)
         stays disabled — i.e. rendered exactly in place, unchanged. -->
    <Teleport to="body" :disabled="placement !== 'above'">
      <div
        v-if="isOpen"
        ref="menuRef"
        role="menu"
        :aria-label="label"
        class="popover-menu-panel"
        :class="`popover-menu-panel--${align}`"
        :style="panelStyle"
        @keydown.esc="handleEscape"
        @keydown.tab="trapFocus"
      >
        <slot :close="close" :set-first-item-ref="setFirstItemRef" />
      </div>
    </Teleport>
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

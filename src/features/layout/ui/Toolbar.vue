<script setup lang="ts">
import { computed } from 'vue'
import { useUnit } from 'effector-vue/composition'

// Theme, import, export and the More menu are no longer imported here —
// they moved into the documents panel's own top row and are passed to it
// through `AppShell.vue`'s `tools` slot. What is left in this header is
// what actually concerns the open document: its breadcrumb and the
// view-mode switcher. The drawer toggle used to live here too — it's now
// mounted once in `AppShell.vue` (see `DrawerToggleButton.vue`'s own
// comment for why it had to stop being an in-flow header child), so this
// header no longer renders it at all, only reserves room for it.
import { useMediaQuery } from '@/shared/lib/useMediaQuery'
import { $showTooltips } from '@/features/settings'
import { $drawerOpen, DocumentTitle } from '@/features/documents'

import { $viewMode, viewModeChanged } from '../model/layout'
import type { ViewMode } from '../model/layout'

// The drawer side ('left' | 'right') drives which end of the header
// reserves space for the floating toggle (see `headerStyle` below) —
// `layout` already reads `$drawerSide` in `AppShell.vue` (the single
// mounting site) to thread it to `DocumentDrawer.vue`, so it's threaded
// here the same way.
const props = withDefaults(defineProps<{ side?: 'left' | 'right' }>(), { side: 'right' })

const viewMode = useUnit($viewMode)
const showTooltips = useUnit($showTooltips)
const drawerOpen = useUnit($drawerOpen)

// Tailwind's `md` breakpoint (768px) — below it the floating toggle never
// travels into the sidebar (see `DrawerToggleButton.vue`'s own `@media`
// comment): it sits at its closed-state corner in BOTH open and closed
// states there, so the header must reserve room for it unconditionally on
// mobile, not just while the drawer happens to be closed.
const isDesktop = useMediaQuery('(min-width: 768px)')

const reserveToggleSpace = computed(() => !isDesktop.value || !drawerOpen.value)

// Only the dock side's padding is ever overridden — the other side keeps
// whatever the `px-3.5` utility class already gives it (`undefined` here
// means "don't set an inline value, fall through to the class"). Animated
// on the same shared duration/easing as the toggle's own travel, the
// sidebar panel's transform, and the shell's own padding (`main.css`'s
// `--md-motion-duration`/`--md-motion-ease`) via the scoped `<style>`
// below, so the header's edge, the button, and the panel all arrive
// together instead of the header visibly "catching up" a beat later.
const headerStyle = computed(() => ({
  paddingLeft:
    props.side === 'left' && reserveToggleSpace.value ? 'var(--md-header-reserve)' : undefined,
  paddingRight:
    props.side === 'right' && reserveToggleSpace.value ? 'var(--md-header-reserve)' : undefined,
}))

interface ViewModeOption {
  value: ViewMode
  label: string
}

// Text labels, not icons (the user's explicit call) — the underlying
// values are unchanged from before the redesign (`editor` | `split` |
// `preview`, still what's persisted to localStorage and read everywhere
// else in the app), only the visible label reads "Write"/"Split"/"Read".
const viewModeOptions: ViewModeOption[] = [
  { value: 'editor', label: 'Write' },
  { value: 'split', label: 'Split' },
  { value: 'preview', label: 'Read' },
]
</script>

<template>
  <!-- Every child here is static regardless of `side`: the breadcrumb
       always sits at the left end, the view-mode switcher stays centred,
       and the (now empty — see the right-hand spacer's own comment below)
       instrument cluster sits at the right end. This used to mirror the
       whole header layout with `side` — the user asked for that removed,
       since a header that rearranges itself based on a setting read
       poorly; only the toggle button itself was ever asked to move, and it
       has since moved OUT of this header entirely (see `headerStyle`'s
       comment above and `DrawerToggleButton.vue`).
       46px height (user request: "slightly shorter" than the reference
       design's original 52px, was 48px/`h-12` pre-redesign) — a modest
       6px trim, not a redesign. `items-center` keeps every child
       vertically centred regardless of the header's own height; the
       tallest child still fitting inside it is the view-mode switcher
       (`.view-tabs`: 24px buttons + 3px padding top/bottom = 30px), well
       under 46px, so nothing clips. Every icon button in this header
       stays `btn-xs` (24x24, daisyUI's `--size-field` scale), meeting the
       24x24 minimum hit target regardless of the header's own height. -->
  <!-- No background of its own: the header sits directly on the pane behind
       it, so the editor surface runs unbroken from the top of the window.
       It kept a `--md-head` fill while the sidebar was a separate band, and
       with the sidebar now a full-height column the header only ever spans
       the panes — a second surface colour there just drew a line across
       them for no reason. No bottom border either: with no fill behind it,
       a rule under the header was the only thing still drawing a band
       across the top of the document. -->
  <header
    class="header flex h-[46px] shrink-0 items-center gap-4 px-3.5 print:hidden"
    :style="headerStyle"
  >
    <div class="flex min-w-0 flex-1 items-center gap-3">
      <!-- Breadcrumb (folder / title) + the unsaved dot — both owned by
           `DocumentTitle.vue`, see its doc comment. Always left-pinned,
           regardless of `side`. -->
      <DocumentTitle :show-tooltips="showTooltips" />
    </div>

    <div
      class="view-tabs shrink-0"
      role="group"
      aria-label="View mode"
      style="background: var(--md-seg, var(--color-base-200)); border-color: var(--color-base-300)"
    >
      <button
        v-for="option in viewModeOptions"
        :key="option.value"
        type="button"
        class="view-tab"
        :class="{ 'view-tab-active': viewMode === option.value }"
        :aria-pressed="viewMode === option.value"
        :aria-label="option.label"
        :title="showTooltips ? option.label : undefined"
        @click="viewModeChanged(option.value)"
      >
        {{ option.label }}
      </button>
    </div>

    <!-- Theme, import, export and the More menu moved OUT of here and into
         the documents panel's own top row (`DocumentDrawer.vue`) — they are
         app-level tools rather than anything to do with the document being
         edited, and the header is now only as wide as the panes.

         The drawer toggle used to render here too, at the header's right
         end (or left, mirrored by `side`) — it has since moved out of flow
         entirely into `AppShell.vue` (see `DrawerToggleButton.vue`'s own
         comment). This div is now just an empty `flex-1` spacer: without
         it, the left group's own `flex-1` would have nothing to balance
         against and the view-mode switcher in the middle would drift left
         instead of staying centred. -->
    <div class="flex-1" />
  </header>
</template>

<style scoped>
/* Header dock-side padding (`headerStyle`, script above) animates on the
 * same shared duration/easing as every other piece of the
 * toggle-travels-with-the-panel system (`main.css`'s
 * `--md-motion-duration`/`--md-motion-ease`) — `headerStyle` only ever
 * sets the padding VALUES (branching per render), the `transition` itself
 * is declared once here rather than folded into that same inline object,
 * so it's never at risk of being dropped from one branch and not another. */
.header {
  transition:
    padding-left var(--md-motion-duration) var(--md-motion-ease),
    padding-right var(--md-motion-duration) var(--md-motion-ease);
}

/*
 * Segmented Write/Split/Read control — raw `var(--color-*)`/`--md-*`
 * rather than daisyUI's `join`/`btn-primary` utilities. This is a
 * deliberate style change from the pre-redesign switcher (which filled the
 * active segment with `btn-primary`, i.e. the accent colour): the
 * reference design's active segment is a neutral raised chip
 * (`--md-seg-active`), not accent-tinted — matching `Splitter.vue`/
 * `MobileTabs.vue`'s existing convention of hand-rolled state colours for
 * small custom controls.
 *
 * FLAT, Linear-style pill (user request — see main.css's "FLAT BUTTON
 * TREATMENT" comment for the full rationale/history): fully rounded ends
 * (`border-radius: 999px` on both the outer track and each segment, rather
 * than a value tied to the 24px segment height, so the pill stays fully
 * rounded even if that height ever changes) and no gradient/inset
 * highlight/shadow in any state. Active vs inactive is carried by fill +
 * text alone now — not by weight/shadow decoration:
 *   - fill: `--md-seg-active` vs the track's own `--md-seg` (measured
 *     ~1.18-1.23:1 apart in both themes, an L* delta of ~7.4-8.3 — see
 *     main.css's `--md-seg-fg` comment for the exact numbers);
 *   - text colour: full `--color-base-content` (active) vs the muted
 *     `--md-seg-fg` (inactive) — >=4.5:1 against `--md-seg` in both themes
 *     (`--md-seg-fg`'s own comment in main.css has the measured numbers;
 *     `--md-t3`, used here before, measured under the 4.5:1 floor in both
 *     themes for this size of text);
 *   - weight: 600 (active) vs 400 (inactive) — so the distinction never
 *     rests on colour alone.
 * Hover (inactive segments only — the active one already has its own
 * stronger fill) is a flat fill change to `--md-hov`, the same hover token
 * `ImportButton.vue`/`MoreMenu.vue`/`SyncStatusIndicator.vue` already use
 * for their own ghost-button hover state. No separate `:active`/press rule
 * — a click immediately swaps the segment's fill to `--md-seg-active` via
 * `viewModeChanged`, so there's nothing useful for a transient press state
 * to add.
 */
.view-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border: 1px solid;
  border-radius: 999px;
}

.view-tab {
  height: 24px;
  padding: 0 13px;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  background: transparent;
  color: var(--md-seg-fg, var(--color-base-content));
  font: inherit;
  font-size: 12.5px;
  font-weight: 400;
  transition:
    background 120ms ease,
    color 120ms ease;
}

.view-tab:not(.view-tab-active):hover {
  background: var(--md-hov, var(--color-base-300));
}

.view-tab-active {
  background: var(--md-seg-active, var(--color-base-100));
  color: var(--color-base-content);
  font-weight: 600;
}

.view-tab:focus-visible {
  outline: 2px solid var(--md-accent);
  outline-offset: -2px;
}
</style>

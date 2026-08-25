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
  <!-- No background of its own, and at desktop widths no LAYOUT of its own
       either: the scoped `.header` rule below takes this strip out of flow
       (`position: absolute`) so the panes run the full height of the window
       and the document text scrolls to the very top edge, passing under the
       two chips below. Before this, the header was a 46px in-flow band that
       cut the text off at a hard line partway down the window — the text
       simply stopped there, which read as the document starting late.
       Everything the strip itself contributes is now a hit-testing hole:
       `pointer-events-none` here, re-enabled on each chip, so a click
       anywhere in the 46px band that ISN'T on a chip lands in the editor
       underneath and places the caret, exactly as if the header weren't
       there. -->
  <header
    class="header pointer-events-none flex h-[46px] shrink-0 items-center gap-4 px-3.5 print:hidden"
    :style="headerStyle"
  >
    <div class="flex min-w-0 flex-1 items-center gap-3">
      <!-- Breadcrumb (folder / title) + the unsaved dot — both owned by
           `DocumentTitle.vue`, see its doc comment. Always left-pinned,
           regardless of `side`. `md-glass-chip` (main.css) is what lets it
           stay legible with body text scrolling underneath; `min-w-0` +
           `max-w-full` keep a long title truncating inside the chip instead
           of stretching it across the pane. -->
      <div
        class="md-glass-chip pointer-events-auto flex min-w-0 max-w-full items-center rounded-full px-3 py-1"
      >
        <DocumentTitle :show-tooltips="showTooltips" />
      </div>
    </div>

    <!-- NOT `md-glass-chip`: this control's active/inactive states are
         measured against its own `--md-seg` track fill (see the `.view-tabs`
         comment in the scoped style below), so it gets the same translucency
         + blur applied to THAT colour rather than being repainted in the
         chip's `--color-base-100`. Same glass, different base. -->
    <div
      class="view-tabs pointer-events-auto shrink-0"
      role="group"
      aria-label="View mode"
      style="border-color: var(--color-base-300)"
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
 * OUT OF FLOW at desktop widths — the change that lets document text reach
 * the top edge of the window. `AppShell.vue`'s content column is the
 * containing block (it carries `relative` for exactly this); with the
 * header no longer a flex item, `<main>`'s `flex-1` claims the column's
 * full height and both panes scroll edge to edge underneath.
 *
 * The 46px this strip used to occupy is handed back to the panes as
 * `--md-chrome-top` (main.css), which they add as padding INSIDE their own
 * scrollable content — so the first line still rests below the chips at
 * rest, and scrolls under them from there.
 *
 * Breakpoint matches `--md-chrome-top`'s own (768px, Tailwind's `md` and
 * the same threshold `isDesktop` uses in script): below it the header stays
 * a normal in-flow band, because `MobileTabs.vue` sits directly beneath it
 * there and a floating header would cover it.
 *
 * `z-index: 15` — above pane content (which sets none), below the drawer
 * toggle (55), the popover menus (30/70) and the modals (60). The sidebar
 * panel itself never overlaps this strip: the shell pads the content column
 * aside by the panel's own width whenever it is open.
 */
@media (min-width: 768px) {
  .header {
    position: absolute;
    inset-inline: 0;
    top: 0;
    z-index: 15;
  }
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
  /* Glass, but built on this control's OWN `--md-seg` track colour rather
   * than `.md-glass-chip`'s `--color-base-100` — every state contrast
   * documented above (active fill vs track, inactive label vs track) is
   * measured against `--md-seg`, so repainting the track in a different
   * base would invalidate all of it. 88%, higher than the chip's 82%: the
   * inactive label is a deliberately muted `--md-seg-fg` sitting right at
   * its 4.5:1 floor against an opaque track, so this one has less headroom
   * to spend on letting the backdrop through than the breadcrumb does.
   * `-webkit-` first then unprefixed, for the minifier reason in main.css. */
  background-color: color-mix(in srgb, var(--md-seg, var(--color-base-200)) 88%, transparent);
  -webkit-backdrop-filter: blur(14px) saturate(180%);
  backdrop-filter: blur(14px) saturate(180%);
}

/* Matches `.md-glass-chip`'s own reduced-transparency fallback in main.css
 * — back to the fully opaque track this control shipped with before. */
@media (prefers-reduced-transparency: reduce) {
  .view-tabs {
    background-color: var(--md-seg, var(--color-base-200));
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
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

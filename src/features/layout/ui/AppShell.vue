<script setup lang="ts">
import { computed } from 'vue'
import { useUnit } from 'effector-vue/composition'

import { useMediaQuery } from '@/shared/lib/useMediaQuery'
import {
  DocumentDrawer,
  DrawerToggleButton,
  SaveIndicator,
  $drawerOpen,
} from '@/features/documents'
import {
  SettingsModal,
  ShortcutsModal,
  $showTooltips,
  $drawerSide,
  drawerSideChanged,
  $sidebarWidth,
  sidebarWidthChanged,
  SIDEBAR_WIDTH_MIN,
  SIDEBAR_WIDTH_MAX,
} from '@/features/settings'

import Toolbar from './Toolbar.vue'
import MoreMenu from './MoreMenu.vue'
import MobileTabs from './MobileTabs.vue'
import EditorPane from './EditorPane.vue'
import PreviewPane from './PreviewPane.vue'
import Splitter from './Splitter.vue'
import StatusBar from './StatusBar.vue'
import AboutModal from './AboutModal.vue'
import { $viewMode, $splitRatio, $mobileTab } from '../model/layout'

const viewMode = useUnit($viewMode)
const splitRatio = useUnit($splitRatio)
// Drives which pane is visible on mobile. Separate from `$viewMode` (the
// persisted desktop preference) so tapping a tab in MobileTabs.vue can't
// overwrite it — see `layout.ts`.
const mobileTab = useUnit($mobileTab)
// `DocumentDrawer` (in the `documents` feature) never imports `settings`
// directly — see its own doc comment — so both preferences are read here,
// the drawer's single mounting site, and passed down as props.
const showTooltips = useUnit($showTooltips)
const drawerSide = useUnit($drawerSide)
// Read here and threaded into `DocumentDrawer` as props, the same way
// `drawerSide` is — that feature never imports `settings` itself.
const sidebarWidth = useUnit($sidebarWidth)
// Needed here (not just inside `DocumentDrawer.vue`/`DrawerToggleButton.vue`
// themselves) to compute `shellStyle` below — the shell's own padding has
// to know whether the panel is open, same as the panel's own transform
// does.
const drawerOpen = useUnit($drawerOpen)

// Tailwind's default `md` breakpoint (768px) — below it there isn't room
// for a resizable split, so the layout switches to Editor|Preview tabs.
// Also gates `shellStyle` below: the mobile drawer is a full-viewport
// overlay over otherwise-unchanged content (see `DocumentDrawer.vue`), so
// nothing needs to cede layout space to it there.
const isDesktop = useMediaQuery('(min-width: 768px)')

const showEditor = computed(() =>
  isDesktop.value ? viewMode.value !== 'preview' : mobileTab.value === 'editor',
)
const showPreview = computed(() =>
  isDesktop.value ? viewMode.value !== 'editor' : mobileTab.value === 'preview',
)
const showSplitter = computed(() => isDesktop.value && viewMode.value === 'split')

// `DocumentDrawer.vue`'s panel is `position: absolute` now (a full-height
// overlay, see its own comment), which — unlike the flex-item `width` it
// used to own before this phase — no longer reclaims or cedes layout space
// on its own: an absolutely positioned element is out of flow entirely, so
// the content column's flex-1 would otherwise just span the shell's full
// width regardless of whether the panel is sitting on top of it. This
// padding does the reclaiming instead, sized to the exact same
// `--md-sidebar-width` the panel itself uses (`main.css` — one constant,
// so the two can't drift apart), and animated on the same shared
// duration/easing as the panel's own transform and the toggle's own
// travel (`--md-motion-duration`/`--md-motion-ease`, see the `<style>`
// block below) so the content column's edge and the panel's edge arrive
// together. Mobile's drawer is a full-viewport overlay over otherwise-
// static content (unchanged from before), so nothing is reserved there.
const shellStyle = computed(() => {
  if (!isDesktop.value) return {}
  const reserved = drawerOpen.value ? 'var(--md-sidebar-width)' : '0px'
  return {
    paddingLeft: drawerSide.value === 'left' ? reserved : undefined,
    paddingRight: drawerSide.value === 'right' ? reserved : undefined,
  }
})

// Only overridden in desktop split mode — editor-only, preview-only, and
// mobile all fall through to the pane's own default `flex-1`, since
// they're always the sole visible flex child at that point.
const editorInlineStyle = computed(() =>
  showSplitter.value ? { flex: '0 0 calc(var(--split-ratio, 0.5) * 100%)' } : undefined,
)

// Phase 2 visual redesign: both panes are now *always* centred to their own
// fixed reading-column max-width (720px editor / 680px preview — see
// `EditorPane.vue`/`PreviewPane.vue`), matching the reference design, which
// centres each pane's content column whether it's the sole visible pane or
// sharing the row in split mode. This used to be conditional on
// `!showSplitter` (full-bleed in split mode, centred only when a pane was
// alone) — the `centered` prop stays (both panes still branch on it) so a
// future mode that genuinely wants full-bleed content has somewhere to hook
// back in, it's just unconditionally `true` for every mode today.
const centered = true
</script>

<template>
  <!-- `relative`: the containing block every absolutely-positioned piece of
       the sidebar-toggle system pins itself against —
       `DocumentDrawer.vue`'s panel AND `DrawerToggleButton.vue`'s button
       both resolve their offsets (and, for the button, its open-state
       translate) against THIS element, so the button's travel and the
       panel's own edge stay meaningful relative to each other. Both are
       out of normal flow now (`position: absolute`), so the single
       remaining flex child below is the content column; `shellStyle`'s
       padding is what makes room for the panel instead of a flex `width`
       the panel itself no longer owns — see that computed's own comment.

       On mobile the drawer is still an overlay (see `DocumentDrawer.vue`'s
       own comment on why `absolute` and `fixed` behave identically here),
       and `shellStyle` reserves no padding for it there — the column below
       simply takes the full width, and the header spans everything exactly
       as before. -->
  <div
    class="relative flex h-dvh overflow-hidden bg-base-100 print:block print:h-auto print:overflow-visible"
    :class="{ 'shell-motion': isDesktop }"
    :style="shellStyle"
  >
    <SettingsModal />
    <ShortcutsModal />
    <AboutModal />
    <!-- Fixed corner status indicator (see `SaveIndicator.vue`) — mounted
         once here, not inside `Toolbar.vue`, since it's a viewport-corner
         overlay rather than a toolbar-flow element. Anchored to the corner
         opposite the docked drawer so it can never render over the
         drawer's own controls, on either side. -->
    <SaveIndicator :side="drawerSide" />

    <!-- The ONE toggle button — see `DrawerToggleButton.vue`'s own comment
         for why it has to be exactly one persistent element mounted here
         rather than rendered (even conditionally) inside `Toolbar.vue` or
         `DocumentDrawer.vue`. -->
    <DrawerToggleButton :side="drawerSide" :show-tooltips="showTooltips" />

    <!-- The app-level tools render through the drawer's `tools` slot rather
         than being imported by `documents` itself — `documents` must not
         reach into `settings`/`transfer`/`layout` (ARCHITECTURE.md), and
         this shell is already the one place that knows about all of them.
         Same reason `showTooltips` is threaded in as a prop. -->
    <DocumentDrawer
      :show-tooltips="showTooltips"
      :side="drawerSide"
      :width="sidebarWidth"
      :width-min="SIDEBAR_WIDTH_MIN"
      :width-max="SIDEBAR_WIDTH_MAX"
      @dock-changed="drawerSideChanged"
      @width-changed="sidebarWidthChanged"
    >
      <!-- One control, not four. The theme cycle, import, and export used to
           sit here as separate buttons; all three are rows inside this menu
           now (user request) — see `MoreMenu.vue`.
           `side` still reaches it so the panel opens INWARD: this row
           mirrors with the dock side, and a right-aligned panel grows
           leftward, so against the left edge of the window it opened
           off-screen. -->
      <template #tools>
        <MoreMenu :show-tooltips="showTooltips" :side="drawerSide" />
      </template>
    </DocumentDrawer>

    <!-- No `order-*` needed any more: the drawer above is `position:
         absolute` (out of flow) now, so this is the only flex child left
         in the shell's own row and there is nothing left to order it
         against.

         `relative`: the containing block for the floating header and status
         bar below. At desktop widths both go `position: absolute` (see
         their own scoped rules) so `<main>` claims the column's full height
         and document text scrolls to the top and bottom edges of the
         window, passing underneath them. Anchoring them HERE rather than to
         the viewport is what keeps them aligned to the panes when the
         sidebar is open — this column is the element the shell's own
         padding narrows, so its edges are already the panes' edges. -->
    <div
      class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden print:block print:h-auto print:overflow-visible"
    >
      <Toolbar :side="drawerSide" />
      <MobileTabs v-show="!isDesktop" />

      <main
        class="flex min-h-0 flex-1 overflow-hidden print:block print:h-auto print:min-h-0 print:overflow-visible"
        :style="{ '--split-ratio': splitRatio }"
      >
        <EditorPane v-show="showEditor" :style="editorInlineStyle" :centered="centered" />
        <Splitter v-show="showSplitter" />
        <PreviewPane v-show="showPreview" :centered="centered" />
      </main>

      <!-- Soft fades at the top and bottom of the pane area — the finishing
           half of the floating chrome above: text scrolls UNDER the
           breadcrumb and the word count now, and without these it would
           simply stop mid-glyph at the window edge, reading as clipped
           rather than scrolled. Siblings of `<main>` rather than children of
           either pane, so one pair covers both panes and the splitter
           between them and neither pane has to know they exist.
           `print:hidden` — a fade to the screen's surface colour over the
           first and last lines of a printed page would just look like a
           smudge. See `.md-edge-fade-*` in main.css; both collapse to zero
           height on mobile, where nothing floats. -->
      <div class="md-edge-fade-top print:hidden" aria-hidden="true" />
      <div class="md-edge-fade-bottom print:hidden" aria-hidden="true" />

      <!-- Word count + GitHub sync status, pulled out of the documents
           drawer's footer and the header respectively into one dedicated
           bottom bar — see `StatusBar.vue` for the full layout/alignment
           rationale. -->
      <StatusBar :show-tooltips="showTooltips" :side="drawerSide" />
    </div>
  </div>
</template>

<style scoped>
/* `shellStyle`'s padding values, animated — see that computed's own
 * comment for why the padding exists at all. Same shared duration/easing
 * as `DocumentDrawer.vue`'s panel transform and `DrawerToggleButton.vue`'s
 * own travel (`main.css`'s `--md-motion-duration`/`--md-motion-ease`), so
 * the content column's edge, the panel, and the button all move together.
 * `.shell-motion` only applies at `md`+ (bound via `isDesktop` in the
 * template) — `shellStyle` never sets a padding value below that
 * breakpoint at all (mobile's drawer is a full-viewport overlay that
 * reserves no shell space), so there is nothing to transition there. */
.shell-motion {
  transition:
    padding-left var(--md-motion-duration) var(--md-motion-ease),
    padding-right var(--md-motion-duration) var(--md-motion-ease);
}
</style>

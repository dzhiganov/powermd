<script setup lang="ts">
import { computed } from 'vue'
import { useUnit } from 'effector-vue/composition'

import { useMediaQuery } from '@/shared/lib/useMediaQuery'
import { DocumentDrawer, SaveIndicator } from '@/features/documents'
import {
  SettingsModal,
  ShortcutsModal,
  ThemeToggle,
  $showTooltips,
  $drawerSide,
  drawerSideChanged,
} from '@/features/settings'
import { ExportMenu, ImportButton } from '@/features/transfer'

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

// Tailwind's default `md` breakpoint (768px) — below it there isn't room
// for a resizable split, so the layout switches to Editor|Preview tabs.
const isDesktop = useMediaQuery('(min-width: 768px)')

const showEditor = computed(() =>
  isDesktop.value ? viewMode.value !== 'preview' : mobileTab.value === 'editor',
)
const showPreview = computed(() =>
  isDesktop.value ? viewMode.value !== 'editor' : mobileTab.value === 'preview',
)
const showSplitter = computed(() => isDesktop.value && viewMode.value === 'split')

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
  <!-- ROW, not column. The drawer is now a full-height sibling of everything
       else, so it runs from the top of the window to the bottom as one
       block, and the header and status bar span only the panes rather than
       crossing the sidebar. Previously this was a column — header, then a
       row holding drawer + panes, then the status bar — which cut the
       sidebar into a band with chrome above and below it.

       On mobile the drawer is `fixed` and so leaves this row's flow
       entirely; the column below simply takes the full width, and the
       header spans everything exactly as before. -->
  <div
    class="relative flex h-dvh overflow-hidden bg-base-100 print:block print:h-auto print:overflow-visible"
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

    <!-- The app-level tools render through the drawer's `tools` slot rather
         than being imported by `documents` itself — `documents` must not
         reach into `settings`/`transfer`/`layout` (ARCHITECTURE.md), and
         this shell is already the one place that knows about all of them.
         Same reason `showTooltips` is threaded in as a prop. -->
    <DocumentDrawer
      :show-tooltips="showTooltips"
      :side="drawerSide"
      @dock-changed="drawerSideChanged"
    >
      <template #tools>
        <ThemeToggle />
        <ImportButton />
        <ExportMenu />
        <MoreMenu :show-tooltips="showTooltips" />
      </template>
    </DocumentDrawer>

    <!-- `order-2` moves this after the drawer when it docks left and before
         it when it docks right — the same ordering the panes used to carry
         themselves, just moved up a level now that the drawer's sibling is
         this whole column rather than `<main>` alone. -->
    <div
      class="order-2 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden print:block print:h-auto print:overflow-visible"
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

      <!-- Word count + GitHub sync status, pulled out of the documents
           drawer's footer and the header respectively into one dedicated
           bottom bar — see `StatusBar.vue` for the full layout/alignment
           rationale. -->
      <StatusBar :show-tooltips="showTooltips" :side="drawerSide" />
    </div>
  </div>
</template>

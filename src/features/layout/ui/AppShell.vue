<script setup lang="ts">
import { computed } from 'vue'
import { useUnit } from 'effector-vue/composition'

import { useMediaQuery } from '@/shared/lib/useMediaQuery'
import { DocumentDrawer, SaveIndicator } from '@/features/documents'
import {
  SettingsModal,
  ShortcutsModal,
  $showTooltips,
  $drawerSide,
  drawerSideChanged,
} from '@/features/settings'

import Toolbar from './Toolbar.vue'
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
  <div
    class="relative flex h-dvh flex-col overflow-hidden bg-base-100 print:block print:h-auto print:overflow-visible"
  >
    <SettingsModal />
    <ShortcutsModal />
    <AboutModal />
    <Toolbar :side="drawerSide" />
    <MobileTabs v-show="!isDesktop" />
    <!-- Fixed corner status indicator (see `SaveIndicator.vue`) — mounted
         once here, not inside `Toolbar.vue`, since it's a viewport-corner
         overlay rather than a toolbar-flow element. Anchored to the corner
         opposite the docked drawer so it can never render over the
         drawer's own controls, on either side. -->
    <SaveIndicator :side="drawerSide" />

    <!-- Docked-drawer row: on desktop, `DocumentDrawer` is a real flex item
         here (see its own `md:static`/`md:w-*` rework) that shares this row
         with `<main>`, so opening/closing it actually resizes the
         editor/preview panes rather than overlaying them. On mobile the
         drawer is `fixed`, so it renders outside this row's flow. -->
    <div
      class="flex min-h-0 flex-1 overflow-hidden print:block print:h-auto print:overflow-visible"
    >
      <DocumentDrawer
        :show-tooltips="showTooltips"
        :side="drawerSide"
        @dock-changed="drawerSideChanged"
      />

      <main
        class="order-2 flex min-h-0 flex-1 overflow-hidden print:block print:h-auto print:min-h-0 print:overflow-visible"
        :style="{ '--split-ratio': splitRatio }"
      >
        <EditorPane v-show="showEditor" :style="editorInlineStyle" :centered="centered" />
        <Splitter v-show="showSplitter" />
        <PreviewPane v-show="showPreview" :centered="centered" />
      </main>
    </div>

    <!-- Word count + GitHub sync status, pulled out of the documents
         drawer's footer and the header respectively into one dedicated
         bottom bar — see `StatusBar.vue` for the full layout/alignment
         rationale. -->
    <StatusBar :show-tooltips="showTooltips" :side="drawerSide" />
  </div>
</template>

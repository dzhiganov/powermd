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
import { GitHubModal } from '@/features/github'
import { WordCount } from '@/features/editor'
import { Outline } from '@/features/outline'

import Toolbar from './Toolbar.vue'
import MobileTabs from './MobileTabs.vue'
import EditorPane from './EditorPane.vue'
import PreviewPane from './PreviewPane.vue'
import Splitter from './Splitter.vue'
import ZenExitButton from './ZenExitButton.vue'
import { $viewMode, $splitRatio, $mobileTab } from '../model/layout'
import { $zenMode } from '../model/zen'

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

// Document outline (Step: preview-only mode) — visible exactly when the
// preview is the *sole* shown pane, desktop "Read" mode and mobile's
// preview tab both included (see `features/outline/model/outline.ts`'s own
// `isOutlineActive`, which mirrors this same condition for the scroll-spy
// session). Docks on the side OPPOSITE the documents panel's configured
// side — not its current open/closed state, just which edge it's set to
// dock on — so the two never compete for the same edge.
const showOutline = computed(() => showPreview.value && !showEditor.value)
const outlineSide = computed(() => (drawerSide.value === 'right' ? 'left' : 'right'))

// Zen mode: hides every piece of chrome in this template except the
// EditorPane/PreviewPane content itself — see `../model/zen.ts`. Combined
// with each element's own existing `v-show` condition (`&&`) rather than a
// second `v-show` directive on the same component tag: stacking two
// independent `v-show`s on one root element is unreliable (Vue's runtime
// directive only stores one "restore to this display value" slot), so
// every toggle below is a single combined boolean instead.
const zenMode = useUnit($zenMode)

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
    <GitHubModal />
    <Toolbar v-show="!zenMode" :side="drawerSide" />
    <MobileTabs v-show="!isDesktop && !zenMode" />
    <!-- Fixed corner status indicator (see `SaveIndicator.vue`) — mounted
         once here, not inside `Toolbar.vue`, since it's a viewport-corner
         overlay rather than a toolbar-flow element. Anchored to the corner
         opposite the docked drawer so it can never render over the
         drawer's own controls, on either side. Wrapped in a plain
         `display:contents` div (rather than a second `v-show` stacked on
         `SaveIndicator` itself) since that component already carries its
         own internal `v-show` — see the `zenMode` doc comment above for
         why two `v-show`s on one element is unreliable. -->
    <div v-show="!zenMode" class="contents">
      <SaveIndicator :side="drawerSide" />
    </div>
    <ZenExitButton />

    <!-- Docked-drawer row: on desktop, `DocumentDrawer` is a real flex item
         here (see its own `md:static`/`md:w-*` rework) that shares this row
         with `<main>`, so opening/closing it actually resizes the
         editor/preview panes rather than overlaying them. On mobile the
         drawer is `fixed`, so it renders outside this row's flow. The
         document outline (`Outline`, preview-only mode) is a third flex
         item in this same row, opposite the drawer — each of the three
         carries an explicit `order-*` class (drawer/outline set their own
         internally, based on `side`; `main` is pinned to the middle here)
         rather than relying on DOM/source order, since a `display:contents`
         wrapper (`DocumentDrawer`'s own root) never itself participates in
         flex layout — only its children do — and mixing that with
         source-order tie-breaking got fragile once a third sibling was
         added. -->
    <div
      class="flex min-h-0 flex-1 overflow-hidden print:block print:h-auto print:overflow-visible"
    >
      <DocumentDrawer
        v-show="!zenMode"
        :show-tooltips="showTooltips"
        :side="drawerSide"
        @dock-changed="drawerSideChanged"
      >
        <!-- Word count moves from the old global footer bar (removed in
             the Phase 2 visual redesign) into the sidebar's own footer,
             beside its dock-side control — see `DocumentDrawer.vue`'s
             `footer-extra` slot doc comment. -->
        <template #footer-extra>
          <WordCount />
        </template>
      </DocumentDrawer>

      <main
        class="order-2 flex min-h-0 flex-1 overflow-hidden print:block print:h-auto print:min-h-0 print:overflow-visible"
        :style="{ '--split-ratio': splitRatio }"
      >
        <EditorPane v-show="showEditor" :style="editorInlineStyle" :centered="centered" />
        <Splitter v-show="showSplitter && !zenMode" />
        <PreviewPane v-show="showPreview" :centered="centered" />
      </main>

      <Outline v-show="showOutline && !zenMode" :side="outlineSide" />
    </div>
  </div>
</template>

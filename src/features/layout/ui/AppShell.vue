<script setup lang="ts">
import { computed } from 'vue'
import { useUnit } from 'effector-vue/composition'

import { useMediaQuery } from '@/shared/lib/useMediaQuery'
import { DocumentDrawer } from '@/features/documents'

import Toolbar from './Toolbar.vue'
import MobileTabs from './MobileTabs.vue'
import EditorPane from './EditorPane.vue'
import PreviewPane from './PreviewPane.vue'
import Splitter from './Splitter.vue'
import { $viewMode, $splitRatio, $mobileTab } from '../model/layout'

const viewMode = useUnit($viewMode)
const splitRatio = useUnit($splitRatio)
// Drives which pane is visible on mobile. Separate from `$viewMode` (the
// persisted desktop preference) so tapping a tab in MobileTabs.vue can't
// overwrite it — see `layout.ts`.
const mobileTab = useUnit($mobileTab)

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

// A pane is the sole visible one whenever the split isn't showing — that
// covers desktop editor-only/preview-only *and* every mobile state (mobile
// never shows the splitter, see `showSplitter` above). Only desktop split
// mode gets both panes side by side, so it's the one case that keeps its
// current full-width-of-pane behaviour with no content max-width.
const singlePane = computed(() => !showSplitter.value)
</script>

<template>
  <div
    class="relative flex h-dvh flex-col overflow-hidden bg-base-100 print:block print:h-auto print:overflow-visible"
  >
    <DocumentDrawer />
    <Toolbar />
    <MobileTabs v-show="!isDesktop" />

    <main
      class="flex min-h-0 flex-1 overflow-hidden print:block print:h-auto print:min-h-0 print:overflow-visible"
      :style="{ '--split-ratio': splitRatio }"
    >
      <EditorPane v-show="showEditor" :style="editorInlineStyle" :centered="singlePane" />
      <Splitter v-show="showSplitter" />
      <PreviewPane v-show="showPreview" :centered="singlePane" />
    </main>
  </div>
</template>

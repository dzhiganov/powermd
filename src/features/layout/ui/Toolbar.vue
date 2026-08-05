<script setup lang="ts">
import { computed } from 'vue'
import { useUnit } from 'effector-vue/composition'
import { Bars3BottomLeftIcon, CloudArrowUpIcon } from '@heroicons/vue/24/outline'

import { ThemeToggle, $showTooltips } from '@/features/settings'
import { DrawerToggleButton, DocumentTitle } from '@/features/documents'
import { ExportMenu } from '@/features/transfer'
import { $activeDocumentForCommit, commitDialogOpened } from '@/features/github'

import { $viewMode, viewModeChanged } from '../model/layout'
import type { ViewMode } from '../model/layout'
import { $outlineOpen, outlineToggled } from '../model/outline'
import MoreMenu from './MoreMenu.vue'

// The drawer side ('left' | 'right') still comes in as a prop — `layout`
// already reads `$drawerSide` in `AppShell.vue` (the single mounting site)
// to thread it to `DocumentDrawer.vue`, so it's threaded here the same way
// — but the header itself no longer reacts to it (see template comment
// below). The prop stays so the drawer can still be told which side it
// docks on without a second independent read of the same store.
withDefaults(defineProps<{ side?: 'left' | 'right' }>(), { side: 'right' })

const viewMode = useUnit($viewMode)
const showTooltips = useUnit($showTooltips)
const outlineOpen = useUnit($outlineOpen)
// Non-null only when the active document was opened from GitHub — drives the
// "Commit to GitHub" control's visibility (read directly here, the same way
// this header already reads several features' public stores).
const activeDocumentForCommit = useUnit($activeDocumentForCommit)

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

// The outline nav only ever renders next to the *preview* pane
// (`PreviewPane.vue`) — in editor-only mode there's nothing for it to
// annotate, so the toggle is disabled rather than silently doing nothing.
const outlineDisabled = computed(() => viewMode.value === 'editor')
</script>

<template>
  <!-- Static layout: the breadcrumb always sits at the left end, the
       view-mode switcher stays centred, and every instrument icon (outline,
       theme, export, more) always sits at the right end, regardless of
       which side the drawer (`side`) actually docks on. This used to mirror
       with `side` — the user asked for that removed, since a header that
       rearranges itself based on a setting read poorly. Fixed 52px height
       per the reference design (was 48px/`h-12` pre-redesign). -->
  <header
    class="flex h-[52px] shrink-0 items-center gap-4 border-b border-base-300 px-3.5 print:hidden"
    style="background: var(--md-head, var(--color-base-200))"
  >
    <div class="flex min-w-0 flex-1 items-center gap-3">
      <DrawerToggleButton :show-tooltips="showTooltips" />
      <div
        class="h-4.5 w-px shrink-0"
        style="background: var(--color-base-300)"
        aria-hidden="true"
      />
      <!-- Breadcrumb (folder / title) + the unsaved dot — both owned by
           `DocumentTitle.vue`, see its doc comment. -->
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

    <div class="flex flex-1 items-center justify-end gap-0.5">
      <button
        type="button"
        class="btn btn-ghost btn-xs btn-square"
        :class="{ 'bg-base-300/70': outlineOpen && !outlineDisabled }"
        :disabled="outlineDisabled"
        aria-label="Toggle outline"
        :aria-pressed="outlineOpen"
        :title="showTooltips ? 'Outline' : undefined"
        @click="outlineToggled()"
      >
        <Bars3BottomLeftIcon class="h-3.5 w-3.5" />
      </button>

      <!-- Only shown when the active document was opened from GitHub — an
           existing, conditional quick action kept in the header (rather
           than folded into the More menu) since it's about *this specific
           document*, not a general app action the way Import/Settings/
           Shortcuts/Print are. -->
      <button
        v-if="activeDocumentForCommit !== null"
        type="button"
        class="btn btn-ghost btn-circle btn-xs"
        aria-label="Commit to GitHub"
        :title="showTooltips ? 'Commit to GitHub' : undefined"
        @click="commitDialogOpened()"
      >
        <CloudArrowUpIcon class="h-4 w-4" />
      </button>

      <ThemeToggle />
      <ExportMenu />
      <!-- GitHub sync's own header icon (previously `GitHubButton`) folds
           into the More menu below — its "GitHub sync" item dispatches the
           exact same `githubModalOpened()` event that button used to, so
           the feature stays fully reachable, just consolidated with
           Import/Settings/Shortcuts/Print rather than each getting its own
           permanent header icon. -->
      <MoreMenu :show-tooltips="showTooltips" />
    </div>
  </header>
</template>

<style scoped>
/*
 * Segmented Write/Split/Read control — raw `var(--color-*)`/`--md-*`
 * rather than daisyUI's `join`/`btn-primary` utilities. This is a
 * deliberate style change from the pre-redesign switcher (which filled the
 * active segment with `btn-primary`, i.e. the accent colour): the
 * reference design's active segment is a neutral raised chip
 * (`--md-seg-active`), not accent-tinted — matching `Splitter.vue`/
 * `MobileTabs.vue`'s existing convention of hand-rolled state colours for
 * small custom controls.
 */
.view-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border: 1px solid;
  border-radius: 9px;
}

.view-tab {
  height: 24px;
  padding: 0 13px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  background: transparent;
  color: var(--md-t3, var(--color-base-content));
  font: inherit;
  font-size: 12.5px;
  font-weight: 450;
  transition:
    background 120ms ease,
    color 120ms ease;
}

.view-tab-active {
  background: var(--md-seg-active, var(--color-base-100));
  color: var(--color-base-content);
  font-weight: 500;
  box-shadow: 0 1px 2px rgb(0 0 0 / 28%);
}

.view-tab:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}
</style>

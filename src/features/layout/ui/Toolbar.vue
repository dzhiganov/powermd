<script setup lang="ts">
import { useUnit } from 'effector-vue/composition'

import { ThemeToggle, $showTooltips } from '@/features/settings'
import { DrawerToggleButton, DocumentTitle } from '@/features/documents'
import { ExportMenu, ImportButton } from '@/features/transfer'
import { SyncStatusIndicator } from '@/features/github'

import { $viewMode, viewModeChanged } from '../model/layout'
import type { ViewMode } from '../model/layout'
import MoreMenu from './MoreMenu.vue'

// The drawer side ('left' | 'right') drives which end of the header the
// drawer toggle button renders at (see the template below) — `layout`
// already reads `$drawerSide` in `AppShell.vue` (the single mounting site)
// to thread it to `DocumentDrawer.vue`, so it's threaded here the same way.
withDefaults(defineProps<{ side?: 'left' | 'right' }>(), { side: 'right' })

const viewMode = useUnit($viewMode)
const showTooltips = useUnit($showTooltips)

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
  <!-- The drawer toggle is the one control that follows `side`: it renders
       at the left end of the header when the drawer docks left, and at the
       right end (alongside its own divider) when it docks right — the
       default. Everything else in this header is genuinely static
       regardless of `side`: the breadcrumb always sits at the left end, the
       view-mode switcher stays centred, and the instrument cluster (commit,
       theme, export, more) always sits at the right end. This used to mirror
       the whole header layout with `side` — the user asked for that
       removed, since a header that rearranges itself based on a setting
       read poorly; only the toggle button itself was asked to move.
       46px height (user request: "slightly shorter" than the reference
       design's original 52px, was 48px/`h-12` pre-redesign) — a modest
       6px trim, not a redesign. `items-center` keeps every child
       vertically centred regardless of the header's own height; the
       tallest child still fitting inside it is the view-mode switcher
       (`.view-tabs`: 24px buttons + 3px padding top/bottom = 30px), well
       under 46px, so nothing clips. Every icon button in this header
       stays `btn-xs` (24x24, daisyUI's `--size-field` scale), meeting the
       24x24 minimum hit target regardless of the header's own height. -->
  <header
    class="flex h-[46px] shrink-0 items-center gap-4 border-b border-base-300 px-3.5 print:hidden"
    style="background: var(--md-head, var(--color-base-200))"
  >
    <div class="flex min-w-0 flex-1 items-center gap-3">
      <template v-if="side === 'left'">
        <DrawerToggleButton :show-tooltips="showTooltips" />
        <div
          class="h-4.5 w-px shrink-0"
          style="background: var(--color-base-300)"
          aria-hidden="true"
        />
      </template>
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

    <!-- Instrument cluster — always right-pinned, regardless of `side`. -->
    <div class="flex flex-1 items-center justify-end gap-0.5">
      <!-- Unobtrusive, always-visible sync state once a GitHub sync
           connection exists (hidden entirely before then) — see its own
           doc comment. Every document/folder syncs automatically in the
           background now, so there's no more per-document "Commit"/"Save"
           action to gate on the active document the way the old per-file
           flow did. -->
      <SyncStatusIndicator :show-tooltips="showTooltips" />

      <ThemeToggle />
      <!-- Own toolbar icon (user request: no longer duplicated inside the
           More menu below — its `menuItem` prop variant is unused now, see
           `MoreMenu.vue`'s own comment). Sits beside `ExportMenu` as the
           import/export pair. -->
      <ImportButton />
      <ExportMenu />
      <!-- GitHub sync's own header icon (previously `GitHubButton`) folds
           into the More menu below — its "GitHub sync" item dispatches the
           exact same `githubModalOpened()` event that button used to, so
           the feature stays fully reachable, just consolidated with
           Settings/Shortcuts rather than each getting its own permanent
           header icon (Import and Print each have their own dedicated
           entry point elsewhere now — this toolbar button and `ExportMenu`'s
           "Print / PDF" respectively — so neither needs a duplicate here
           too). -->
      <MoreMenu :show-tooltips="showTooltips" />

      <template v-if="side === 'right'">
        <div
          class="h-4.5 w-px shrink-0"
          style="background: var(--color-base-300)"
          aria-hidden="true"
        />
        <DrawerToggleButton :show-tooltips="showTooltips" />
      </template>
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
    color 120ms ease,
    box-shadow 120ms ease;
}

/* Convex treatment (see main.css's "CONVEX BUTTON TREATMENT" comment for
 * the token rationale) — this hand-rolled active chip isn't a `.btn`, so
 * it reads the same `--md-btn-*` tokens directly rather than duplicating
 * the gradient/shadow values. A top-lightening gradient + a 1px inset
 * top-edge highlight is the same two-layer bevel every other button in
 * the app gets — no drop shadow (see main.css's "DROP SHADOW REMOVED"
 * comment on `.btn`; this hand-rolled control follows the same removal). */
.view-tab-active {
  background: var(--md-seg-active, var(--color-base-100));
  background-image: linear-gradient(to bottom, var(--md-btn-sheen), transparent 65%);
  color: var(--color-base-content);
  font-weight: 500;
  box-shadow: inset 0 1px 0 0 var(--md-btn-highlight);
}

/* Pressed: flatten to a single inset shadow, same pattern as `.btn`'s
 * `:active:not(.btn-active)` rule in main.css. Applies to both the active
 * and inactive segments, since either can be the thing under the pointer
 * at the moment of the click. */
.view-tab:active {
  background-image: none;
  box-shadow: inset 0 1px 2px 0 var(--md-btn-press);
}

.view-tab:focus-visible {
  outline: 2px solid var(--md-accent);
  outline-offset: -2px;
}

@media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
  .view-tab,
  .view-tab-active,
  .view-tab:active {
    background-image: none;
    box-shadow: none;
  }
}
</style>

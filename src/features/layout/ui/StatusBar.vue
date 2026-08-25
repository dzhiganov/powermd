<script setup lang="ts">
// `layout` is the one feature allowed to know both `editor` and `github`
// exist (see `ARCHITECTURE.md` / eslint boundaries — neither of those two
// features imports the other, or imports `layout`) — same shape as
// `Toolbar.vue` already importing `SyncStatusIndicator` from `github`
// directly, and `AppShell.vue` already importing `WordCount` from `editor`
// directly. `showTooltips`/`side` are threaded down as props rather than
// read from `@/features/settings` here — this component's own mounting
// site, `AppShell.vue`, already reads both and threads them the same way
// it does for `DocumentDrawer.vue`/`Toolbar.vue`.
import { WordCount } from '@/features/editor'
import { SyncStatusIndicator } from '@/features/github'

withDefaults(defineProps<{ showTooltips?: boolean; side?: 'left' | 'right' }>(), {
  side: 'right',
})
</script>

<template>
  <!-- Full-width, sitting below the docked-drawer row (`AppShell.vue`) —
       not scoped to just the editor/preview pane area. Word count and sync
       status are both whole-app concerns (which document is open, whether
       *any* content has reached GitHub), not something scoped to a single
       pane, so a full-width bar reads as "the app's status", the same way
       the header above spans the same full width regardless of panes. It
       also keeps this component simple: no need to track the drawer's own
       (animating) width to stay aligned under `<main>`.

       Content aligns to the side OPPOSITE the docked drawer (`side`), the
       same rule `SaveIndicator.vue` already follows for its fixed corner
       readout — so it never ends up sitting visually below the drawer's
       own footer controls on either dock side, and it also means the
       alignment flips live the instant the drawer-side setting does, since
       `side` is just a reactive prop.

       `shrink-0`: a fixed-height row in `AppShell.vue`'s outer flex column,
       exactly like the header/`MobileTabs.vue` above it — it takes a fixed
       slice of the `h-dvh` column and the docked-drawer row's own
       `flex-1 min-h-0` absorbs whatever height is left, so adding this bar
       can never introduce page-level scroll or grow past the viewport.
       `overflow-hidden` + `gap-3` on the row (rather than letting it wrap)
       keeps it to one line at any width — see `WordCount.vue`/
       `SyncStatusIndicator.vue`'s own `sm:`-breakpoint rules for how each
       degrades its own content down to fit a narrow phone instead. -->
  <!-- No background, same reasoning as the header (see `Toolbar.vue`): it
       spans only the panes now, so it sits on the pane surface rather than
       banding a second colour across it. The top border still divides it
       from the text above. -->
  <footer
    class="flex h-8 shrink-0 items-center gap-3 overflow-hidden px-3 text-xs print:hidden"
    :class="side === 'right' ? 'justify-start' : 'justify-end'"
    aria-label="Status bar"
  >
    <WordCount />
    <SyncStatusIndicator :show-tooltips="showTooltips" />
  </footer>
</template>

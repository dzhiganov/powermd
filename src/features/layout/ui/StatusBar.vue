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
  <!-- Out of flow at desktop widths (see the scoped `.status-bar` rule
       below) — the mirror image of `Toolbar.vue`'s floating header, for the
       same reason: the panes run the full height of the window and the
       document's last line scrolls to the bottom edge, passing under this
       readout instead of stopping short at a band above it.
       `pointer-events-none` on the strip, re-enabled on the chip, so a
       click anywhere in the 32px band that isn't on the chip lands in the
       editor underneath and places the caret. -->
  <footer
    class="status-bar pointer-events-none flex h-8 shrink-0 items-center overflow-hidden px-3 text-xs print:hidden"
    :class="side === 'right' ? 'justify-start' : 'justify-end'"
    aria-label="Status bar"
  >
    <!-- Both readouts share ONE chip rather than one each: they are a single
         status line, and two separate pills with a gap between them read as
         two unrelated controls. `gap-3` moved off the strip onto this row so
         the chip hugs its content instead of spanning the pane. -->
    <div class="md-glass-chip pointer-events-auto flex items-center gap-3 rounded-full px-3 py-0.5">
      <WordCount />
      <SyncStatusIndicator :show-tooltips="showTooltips" />
    </div>
  </footer>
</template>

<style scoped>
/*
 * Out of flow at desktop widths — see `Toolbar.vue`'s `.header` rule for
 * the full reasoning (same containing block, same breakpoint, same z-index
 * band); this is its bottom-edge counterpart. The 32px it used to occupy
 * comes back to the panes as `--md-chrome-bottom` (main.css), added as
 * padding inside their own scrollable content.
 */
@media (min-width: 768px) {
  .status-bar {
    position: absolute;
    inset-inline: 0;
    bottom: 0;
    z-index: 15;
  }
}
</style>

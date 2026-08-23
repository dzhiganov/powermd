<script setup lang="ts">
import { computed } from 'vue'
import { useUnit } from 'effector-vue/composition'
import { Bars3Icon, XMarkIcon } from '@heroicons/vue/24/outline'

import { $drawerOpen, drawerToggled } from '../model/documents'

// `showTooltips` and `side` come in as props rather than a direct
// `@/features/settings` import — `documents` and `settings` never import
// each other's internals (see ARCHITECTURE.md). `side` used to be threaded
// through `Toolbar.vue` (the header, in the `layout` feature); it's now
// threaded through `AppShell.vue` instead — this component's single
// mounting site — for the same boundary reason, see this component's own
// template comment below for why the mounting site moved.
withDefaults(defineProps<{ showTooltips?: boolean; side?: 'left' | 'right' }>(), {
  side: 'right',
})

const open = useUnit($drawerOpen)

const label = computed(() => (open.value ? 'Close sidebar' : 'Open sidebar'))
</script>

<template>
  <!-- The ONE toggle button in the whole app. It used to live inside
       `Toolbar.vue`'s header flow, at whichever end `side` pointed to; it
       is now mounted once, here, directly in `AppShell.vue`, and nowhere
       else — `DocumentDrawer.vue`'s own top row never renders a second
       copy. A v-if/v-else pair (one instance in the header, a second one
       inside the drawer, toggled by `open`) would unmount and remount a
       fresh element every time the drawer opens or closes, which kills the
       CSS transition below mid-flight — there would be nothing to animate
       FROM the instant the old instance disappears. Being the one thing
       that both starts the animation (by dispatching `drawerToggled`) and
       is itself carried BY that same animation is only possible if it's a
       single persistent element throughout.

       Absolutely positioned against `AppShell.vue`'s root shell element
       (the nearest `position: relative` ancestor) rather than `fixed`
       against the viewport: the closed-state corner offset
       (`--md-toggle-corner`) and the open-state translate
       (`--md-toggle-open-x`, see `main.css`) are both defined relative to
       that shell, and only stay correct relative to EACH OTHER — and
       relative to `DocumentDrawer.vue`'s own panel, which is absolutely
       positioned against the very same ancestor — if all three share one
       containing block.

       `z-55` (scoped style below): above the sidebar panel's own `z-50`
       and its mobile backdrop's `z-40` (`DocumentDrawer.vue`) — the button
       must stay clickable (to close the drawer) even while the panel is
       open and, on mobile, sitting on top of everything else. Below every
       modal dialog's `z-60`+ (`SettingsModal.vue` etc.) — a modal covering
       the whole app should cover this too. -->
  <button
    type="button"
    class="sidebar-toggle print:hidden"
    :class="[
      side === 'right' ? 'sidebar-toggle-right' : 'sidebar-toggle-left',
      { 'is-open': open },
    ]"
    :aria-label="label"
    :aria-pressed="open"
    :title="showTooltips ? label : undefined"
    @click="drawerToggled()"
  >
    <!-- Icon morph (spec: crossfade + counter-rotate) — two SVGs stacked
         absolutely on top of each other inside the button, both always
         mounted (never `v-if`'d between them), so the crossfade has both
         ends of the fade to animate between. `Bars3Icon` (closed: "open
         the sidebar") and `XMarkIcon` (open: "close the sidebar") counter-
         rotate in opposite directions as they swap — see the scoped style
         below for the actual rotate/opacity values and durations. -->
    <span class="sidebar-toggle-icon sidebar-toggle-icon-menu" aria-hidden="true">
      <Bars3Icon class="h-3.5 w-3.5" />
    </span>
    <span class="sidebar-toggle-icon sidebar-toggle-icon-close" aria-hidden="true">
      <XMarkIcon class="h-3.5 w-3.5" />
    </span>
  </button>
</template>

<style scoped>
/* NOT named `drawer-toggle`. That is daisyUI's own class for the hidden
 * checkbox at the heart of its drawer component, and it ships
 * `.drawer-toggle { appearance: none; opacity: 0; width: 0; height: 0 }`.
 * Reusing the name handed this button an `opacity: 0` nothing here
 * competed with: the scoped rules below outrank daisyUI's on width and
 * height, so it measured a correct 28x28 at a correct offset and was
 * completely invisible. Every geometry assertion passed while nothing was
 * painted. Any class name on an element in this app has to clear daisyUI's
 * namespace first.
 *
 * Hand-rolled rather than daisyUI's `btn btn-ghost btn-xs btn-square`
 * (what this button used before it needed absolute positioning + a
 * specific `--md-toggle-size` footprint the spec's translate arithmetic
 * depends on) — daisyUI's size utilities express themselves as padding
 * around a min-height, not a fixed box, which fights a formula that needs
 * an exact, known width. Colour/hover convention matches the app's other
 * small icon controls (`.dock-btn` in `DocumentDrawer.vue`, `.view-tab` in
 * `Toolbar.vue`): transparent at rest, `--md-hov` on hover, `--md-seg-fg`
 * icon colour, `--md-accent` focus ring.
 */
.sidebar-toggle {
  position: absolute;
  top: var(--md-toggle-top);
  z-index: 55;
  display: block;
  width: var(--md-toggle-size);
  height: var(--md-toggle-size);
  padding: 0;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  background: transparent;
  color: var(--md-seg-fg, var(--color-base-content));
  transition:
    background 120ms ease,
    color 120ms ease,
    transform var(--md-motion-duration) var(--md-motion-ease);
}

.sidebar-toggle:hover {
  background: var(--md-hov, var(--color-base-300));
}

.sidebar-toggle:focus-visible {
  outline: 2px solid var(--md-accent);
  outline-offset: -2px;
}

.sidebar-toggle-right {
  right: var(--md-toggle-corner);
}

.sidebar-toggle-left {
  left: var(--md-toggle-corner);
}

/* The open-state travel only applies at `md` (768px) and up — below that,
 * `DocumentDrawer.vue`'s panel is a `min(320px, 85vw)` sheet rather than a
 * guaranteed-320px docked rail, so the `--md-toggle-open-x` formula (which
 * assumes the full 320px) would overshoot a narrow phone's actual panel
 * edge. The button simply stays put at its closed-state corner on mobile,
 * in BOTH open and closed states there; `z-55` already keeps it above the
 * panel and its backdrop, so it stays visible and reachable (to close the
 * drawer again) even while the mobile sheet is open underneath it. */
@media (min-width: 768px) {
  .sidebar-toggle-right.is-open {
    transform: translateX(calc(-1 * var(--md-toggle-open-x)));
  }

  .sidebar-toggle-left.is-open {
    transform: translateX(var(--md-toggle-open-x));
  }
}

.sidebar-toggle-icon {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  transition:
    opacity var(--md-icon-fade-duration) var(--md-motion-ease),
    transform var(--md-icon-rotate-duration) var(--md-motion-ease);
}

.sidebar-toggle-icon-menu {
  opacity: 1;
  transform: none;
}

.is-open .sidebar-toggle-icon-menu {
  opacity: 0;
  transform: rotate(90deg) scale(0.8);
}

.sidebar-toggle-icon-close {
  opacity: 0;
  transform: rotate(-90deg) scale(0.8);
}

.is-open .sidebar-toggle-icon-close {
  opacity: 1;
  transform: none;
}
</style>

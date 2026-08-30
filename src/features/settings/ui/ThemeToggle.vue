<script setup lang="ts">
import { computed, type Component } from 'vue'
import { useUnit } from 'effector-vue/composition'
import { SunIcon, MoonIcon, ComputerDesktopIcon } from '@heroicons/vue/24/outline'

import { THEMES, type Theme } from '@/shared/config/theme'
import { $theme, themeChanged, themeCycled } from '../model/theme'

// `menuItem`: renders as the three-icon segmented switcher that sits at the
// top of `layout/ui/MoreMenu.vue`'s popover instead of a standalone icon
// button. The two branches also differ in what a click MEANS — the switcher
// sets a mode outright (`themeChanged`), the icon button steps to the next
// one (`themeCycled`) — because a control with three hit targets can say
// which mode you meant and a control with one cannot. This is now the only
// rendering used (the theme control moved off the documents panel's tools
// row into that menu, user request); the icon-button branch stays for any
// future toolbar.
withDefaults(defineProps<{ menuItem?: boolean }>(), { menuItem: false })

const theme = useUnit($theme)

// Icons only, no text. The three modes are the whole vocabulary of this
// control and each has a conventional glyph, so labels would repeat what
// the icons already say and push a 296px menu into wrapping. The names
// still exist for anyone not looking at the icons — they are each button's
// `aria-label` below, which is also what makes every segment individually
// nameable to a screen reader rather than one row that reads as its
// current value.
interface ThemeSegment {
  id: Theme
  label: string
  icon: Component
}

const THEME_SEGMENTS: ThemeSegment[] = [
  { id: THEMES.light, label: 'Light theme', icon: SunIcon },
  { id: THEMES.dark, label: 'Dark theme', icon: MoonIcon },
  { id: THEMES.system, label: 'System theme', icon: ComputerDesktopIcon },
]

// The icon button's label describes what a click will switch *to* (matching
// the pre-existing "Switch to light/dark theme" copy), not the current
// state — with a single hit target that action is the only thing the button
// can usefully announce.
const NEXT_LABEL: Record<Theme, string> = {
  [THEMES.light]: 'Switch to dark theme',
  [THEMES.dark]: 'Switch to system theme',
  [THEMES.system]: 'Switch to light theme',
}

const label = computed(() => NEXT_LABEL[theme.value])

function handleClick() {
  themeCycled()
}
</script>

<template>
  <!-- Deliberately does NOT close the popover it sits in — every sibling
       item there does, so this is the one exception, and it is the point of
       the control: picking a theme is something you do while looking at the
       result. A switcher that dismissed the menu on click would turn
       comparing light against dark into "open the menu, click, reopen the
       menu, click". Staying open leaves all three segments under the cursor
       with the active one moving in place, and any click outside still
       dismisses as usual. -->
  <div v-if="menuItem" class="theme-seg" role="group" aria-label="Theme">
    <button
      v-for="segment in THEME_SEGMENTS"
      :key="segment.id"
      type="button"
      role="menuitem"
      class="theme-seg-btn"
      :class="{ 'theme-seg-btn-active': theme === segment.id }"
      :aria-label="segment.label"
      :aria-pressed="theme === segment.id"
      @click="themeChanged(segment.id)"
    >
      <component :is="segment.icon" class="h-3.5 w-3.5" />
    </button>
  </div>
  <button
    v-else
    type="button"
    class="btn btn-ghost btn-circle btn-xs"
    :aria-label="label"
    @click="handleClick"
  >
    <SunIcon v-if="theme === THEMES.light" class="h-3.5 w-3.5" />
    <MoonIcon v-else-if="theme === THEMES.dark" class="h-3.5 w-3.5" />
    <ComputerDesktopIcon v-else class="h-3.5 w-3.5" />
  </button>
</template>

<style scoped>
/*
 * Same segmented-control treatment as `layout/ui/Toolbar.vue`'s view-mode
 * switcher (`.view-tabs`/`.view-tab`): a rounded `--md-seg` track, the
 * current segment filled with `--md-seg-active`, the other two labelled in
 * the muted `--md-seg-fg`. Reusing that vocabulary rather than inventing a
 * second one is what makes "pick one of these" look like one thing across
 * the app — and it introduces no new colour, so the contrast already
 * measured for those tokens (see `--md-seg-fg`'s own comment in
 * `app/styles/main.css`) carries over unchanged.
 *
 * The one deliberate difference: a flat, fully opaque `--md-seg` fill,
 * where `.view-tabs` uses a translucent version of the same token plus a
 * backdrop blur. That control floats over scrolling document text and needs
 * the glass to sit in the header; this one sits on `PopoverMenu`'s own
 * solid `--md-pop` panel, where a blur layer would cost paint work to
 * composite one opaque surface over another.
 */
/* `inline-flex`, so the track is only as wide as the three icons need.
 *
 * It was `flex` with `flex: 1` segments, stretching the pill across the full
 * 296px of the menu on the reasoning that every other row is full-width. In
 * practice that read as one oversized slab at the top of the menu: a row of
 * TEXT fills its width because the text does, but three 14px glyphs spread
 * over 276px are mostly empty pill. Hugging the content makes it read as one
 * small control, which is what it is.
 *
 * `margin-inline: 10px` matches `.popover-menu-item`'s own horizontal
 * padding (main.css), so the switcher's first icon lines up with the icon
 * column of every row beneath it rather than floating in its own indent. */
.theme-seg {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin: 3px 10px 5px;
  padding: 2px;
  border-radius: 999px;
  background: var(--md-seg, var(--color-base-200));
}

/* 24px tall — matching `.view-tab` and every other `btn-xs` icon target in
 * the app, and the minimum this codebase holds hit targets to. The segments
 * got NARROWER (28px, from an eighth of the menu each) but not shorter: a
 * compact control is one that stops claiming space it does not need, not one
 * that becomes harder to hit. */
.theme-seg-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 24px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--md-seg-fg, var(--color-base-content));
  cursor: pointer;
  transition:
    background 120ms ease,
    color 120ms ease;
}

.theme-seg-btn:not(.theme-seg-btn-active):hover {
  background: var(--md-hov, var(--color-base-300));
}

.theme-seg-btn-active {
  background: var(--md-seg-active, var(--color-base-100));
  color: var(--color-base-content);
}

.theme-seg-btn:focus-visible {
  outline: 2px solid var(--md-accent);
  outline-offset: -2px;
}
</style>

<script setup lang="ts">
/** The four colour buttons, shared by the selection toolbar and the edit
 * popover — the only difference between them is whether one is marked as
 * current, so they are one component rather than two near-copies. */
import { HIGHLIGHT_COLORS, type HighlightColorId } from '@/shared/config/highlightColors'

defineProps<{
  /** The currently applied colour, if any — drawn with a ring. */
  selected?: HighlightColorId | null
}>()

const emit = defineEmits<{ pick: [HighlightColorId] }>()
</script>

<template>
  <div class="flex items-center gap-1.5" role="group" aria-label="Highlight colour">
    <button
      v-for="color in HIGHLIGHT_COLORS"
      :key="color.id"
      type="button"
      class="swatch"
      :class="{ 'swatch-selected': selected === color.id }"
      :style="{
        background: `var(--md-hl-${color.id})`,
        borderColor: `var(--md-hl-${color.id}-accent)`,
      }"
      :aria-label="color.label"
      :aria-pressed="selected === color.id"
      @click="emit('pick', color.id)"
    />
  </div>
</template>

<style scoped>
/* A colour swatch is a non-text control, so its 3:1 floor is against the
 * surface behind it — met by the `-accent` border rather than by the fill,
 * which is deliberately a pale 22% wash (see `highlightColors.ts`) and would
 * not clear it alone. */
.swatch {
  width: 28px;
  height: 28px;
  border: 1px solid;
  border-radius: 7px;
  cursor: pointer;
  transition: transform 120ms ease;
}

.swatch:hover {
  transform: scale(1.06);
}

/* Selection is a ring OUTSIDE the swatch, not a thicker border: a border
 * change would resize the colour patch itself, making the four swatches
 * appear to jump as you move between them. */
.swatch-selected {
  outline: 2px solid var(--color-base-content);
  outline-offset: 2px;
}

.swatch:focus-visible {
  outline: 2px solid var(--md-accent);
  outline-offset: 2px;
}
</style>

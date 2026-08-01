<script setup lang="ts">
import { useUnit } from 'effector-vue/composition'

import { ink } from '@/shared/lib/ink'

import { $html } from '../model/preview'

defineProps<{
  /** Constrains and centres the prose column to a comfortable reading
   * width instead of stretching it edge-to-edge — only meant for
   * single-pane modes, see `layout/ui/AppShell.vue`. */
  centered?: boolean
}>()

const html = useUnit($html)

// Bound into the scoped <style> below via `v-bind()` so the ratio behind
// every one of these colours lives in exactly one place: `shared/lib/ink`.
const linkColor = ink('--color-info')
const codeColor = ink('--color-accent')
const keywordColor = ink('--color-primary')
const stringColor = ink('--color-success')
const titleColor = ink('--color-info')
const numberColor = ink('--color-secondary')
const attributeColor = ink('--color-warning')
const deletionColor = ink('--color-error')
</script>

<template>
  <div
    class="markdown-preview prose prose-sm p-4"
    :class="centered ? 'mx-auto max-w-[75ch]' : 'max-w-none'"
    v-html="html"
  />
</template>

<style scoped>
/*
 * Tailwind Typography's `prose` colours are driven entirely by the
 * `--tw-prose-*` custom properties below, so retargeting them at DaisyUI's
 * own `--color-*` variables is enough for `prose` to repaint itself the
 * moment `data-theme` changes on <html> — the same trick
 * `src/features/editor/lib/theme.ts` uses for the CodeMirror chrome.
 *
 * This deliberately does NOT use `prose-invert` / `dark:prose-invert`.
 * Tailwind's `dark:` variant tracks `prefers-color-scheme` by default,
 * but this app's theme toggle sets `data-theme` on <html> independently
 * of the OS preference (see settings/model/theme.ts) — so `dark:` would
 * drift out of sync with the app's actual theme. Overriding the plain,
 * non-inverted variable set instead means one definition serves both
 * themes, driven by the same DaisyUI variables CodeMirror already uses.
 *
 * The accent colours below (links, inline code, and the hljs roles further
 * down) come from `ink()` in `shared/lib/ink.ts` via the `v-bind()`
 * bindings in <script setup> — DaisyUI's accent/info/success/etc. are
 * button *background* colours (identical in both themes) and fail WCAG AA
 * as foreground text on the light theme, so `ink()` mixes each one toward
 * `--color-base-content` at a single shared ratio. Measured minimum
 * contrast against `--color-base-100` at that ratio: 5.70:1 in the light
 * theme (the `--color-warning`-derived roles), 7.64:1 in the dark theme
 * (the `--color-primary`-derived roles) — both above the 4.5:1 AA floor.
 * Roles that don't need an accent (body text, headings, list markers,
 * borders) resolve straight to a DaisyUI variable instead, at full
 * strength — no alpha or opacity fades on any text colour — so contrast
 * never depends on what happens to be underneath.
 */
.markdown-preview {
  --tw-prose-body: var(--color-base-content);
  --tw-prose-headings: var(--color-base-content);
  --tw-prose-lead: var(--color-base-content);
  --tw-prose-bold: var(--color-base-content);
  --tw-prose-counters: var(--color-base-content);
  --tw-prose-bullets: var(--color-base-content);
  --tw-prose-captions: var(--color-base-content);
  --tw-prose-kbd: var(--color-base-content);
  --tw-prose-quotes: var(--color-base-content);
  --tw-prose-th-borders: var(--color-base-300);
  --tw-prose-td-borders: var(--color-base-300);
  --tw-prose-hr: var(--color-base-300);
  --tw-prose-quote-borders: var(--color-base-300);

  --tw-prose-links: v-bind(linkColor);
  --tw-prose-code: v-bind(codeColor);
  --tw-prose-pre-code: var(--color-base-content);
  --tw-prose-pre-bg: var(--color-base-200);
}

.markdown-preview :deep(a) {
  word-break: break-word;
}

/* Wide tables (many columns, or a narrow split-view pane) scroll inside
 * themselves instead of forcing the whole preview pane to scroll
 * sideways and drag headings/paragraphs out of view — the same
 * `overflow-x: auto` treatment `prose` already applies to `pre`. No wrapper
 * element needed: a table already generates its own block-level box, so
 * `overflow-x` applies directly to it. */
.markdown-preview :deep(table) {
  display: block;
  overflow-x: auto;
}

/* Fenced code blocks: same DaisyUI-mapped palette as the editor's
 * `daisyHighlightStyle` (editor/lib/theme.ts), applied to
 * `rehype-highlight`'s `hljs-*` classNames instead of CodeMirror's Lezer
 * tags, so a code block looks the same whether it's being typed or
 * rendered. Comments only get an italic style, no colour change — dimming
 * via opacity risks dropping a text colour below the 4.5:1 floor
 * depending on what's behind it, so every role here stays at full
 * strength and relies on `ink()`-style mixing (not transparency) for
 * anything that isn't plain body text. */
.markdown-preview :deep(.hljs-keyword),
.markdown-preview :deep(.hljs-selector-tag),
.markdown-preview :deep(.hljs-name),
.markdown-preview :deep(.hljs-built_in) {
  color: v-bind(keywordColor);
}

.markdown-preview :deep(.hljs-string),
.markdown-preview :deep(.hljs-attr),
.markdown-preview :deep(.hljs-symbol),
.markdown-preview :deep(.hljs-bullet),
.markdown-preview :deep(.hljs-addition) {
  color: v-bind(stringColor);
}

.markdown-preview :deep(.hljs-title),
.markdown-preview :deep(.hljs-section) {
  color: v-bind(titleColor);
}

.markdown-preview :deep(.hljs-number),
.markdown-preview :deep(.hljs-literal),
.markdown-preview :deep(.hljs-meta) {
  color: v-bind(numberColor);
}

.markdown-preview :deep(.hljs-attribute),
.markdown-preview :deep(.hljs-variable),
.markdown-preview :deep(.hljs-template-variable),
.markdown-preview :deep(.hljs-type),
.markdown-preview :deep(.hljs-selector-class),
.markdown-preview :deep(.hljs-selector-attr),
.markdown-preview :deep(.hljs-selector-pseudo) {
  color: v-bind(attributeColor);
}

.markdown-preview :deep(.hljs-deletion) {
  color: v-bind(deletionColor);
}

.markdown-preview :deep(.hljs-comment),
.markdown-preview :deep(.hljs-quote) {
  font-style: italic;
}
</style>

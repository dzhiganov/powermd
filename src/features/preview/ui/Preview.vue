<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useUnit } from 'effector-vue/composition'

import { ink } from '@/shared/lib/ink'

import { $html } from '../model/preview'
import { previewScrollHandleMounted, previewScrollHandleUnmounted } from '../model/scrollHandle'
import { renderMermaidDiagrams } from '../lib/mermaidRenderer'

defineProps<{
  /** Constrains and centres the prose column to a comfortable reading
   * width instead of stretching it edge-to-edge — only meant for
   * single-pane modes, see `layout/ui/AppShell.vue`. */
  centered?: boolean
}>()

const html = useUnit($html)

// This component (not `layout/ui/PreviewPane.vue`) owns the scroll
// container — mirrors the editor feature, where `.cm-scroller` is
// internal to `editor` too. That symmetry is what lets `scroll-sync`
// depend on the same small handle shape for both panes without either
// one leaking DOM structure to `layout`.
const scroller = ref<HTMLDivElement | null>(null)
const content = ref<HTMLDivElement | null>(null)

// Mermaid diagrams render on the main thread, after the fact — `$html`
// is already sanitized, worker-rendered markup by the time it lands in
// `v-html` below (see `lib/mermaidRenderer.ts` for why: the worker has
// no DOM, mermaid needs one). `flush: 'post'` is what makes this safe to
// read `content.value`'s *new* DOM from: it runs after Vue has actually
// patched the `v-html` binding, not just after `html` changed in
// Effector. Replacing a `pre` with a diagram (or an error box) inside
// `content.value` is itself a DOM mutation under it, which the scroll-sync
// feature's own `MutationObserver` (`scroll-sync/lib/syncSession.ts`,
// observing `contentRoot` for `childList`/`subtree`/`characterData`)
// already picks up — no separate anchor-invalidation wiring needed here,
// the same way an `<img>` finishing loading already invalidates it today.
watch(
  html,
  () => {
    if (content.value) renderMermaidDiagrams(content.value)
  },
  { flush: 'post' },
)

// A markdown edit changes `$html` (handled above); a theme toggle alone
// does not — `$html` only depends on the markdown source, not on
// `data-theme`. Diagrams already rendered need re-rendering in the new
// theme's resolved colours regardless (mermaid bakes seed colours into
// the SVG at render time — see `mermaidTheme.ts` — rather than emitting
// `var(...)` references a theme change could repaint for free), so this
// watches the one thing that actually changes: the attribute
// `features/settings/model/theme.ts` writes to `<html>`. A
// `MutationObserver` here rather than importing `@/features/settings`'s
// `$theme` store keeps this feature's theme-reactivity consistent with
// how `ink.ts`/CodeMirror's own theming already work — off the DOM
// attribute, not a cross-feature store dependency.
let themeObserver: MutationObserver | null = null

onMounted(() => {
  const scrollerEl = scroller.value
  const contentEl = content.value
  if (!scrollerEl || !contentEl) return

  previewScrollHandleMounted({
    getScroller: () => scrollerEl,
    getContentRoot: () => contentEl,
  })

  themeObserver = new MutationObserver(() => {
    if (content.value) renderMermaidDiagrams(content.value)
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
})

onUnmounted(() => {
  previewScrollHandleUnmounted()
  themeObserver?.disconnect()
  themeObserver = null
})

// Bound into the scoped <style> below via `v-bind()` so the ratio behind
// every one of these colours lives in exactly one place: `shared/lib/ink`.
const linkColor = ink('--color-info')
const codeColor = ink('--color-accent')
// `--md-accent`, not `--color-primary`: this is accent-as-foreground-text,
// the TEXT role — see "PRIMARY SURFACE/ACCENT SPLIT — Phase 4" in
// `app/styles/main.css`.
const keywordColor = ink('--md-accent')
const stringColor = ink('--color-success')
const titleColor = ink('--color-info')
const numberColor = ink('--color-secondary')
const attributeColor = ink('--color-warning')
const deletionColor = ink('--color-error')

// 680px is the reference design's fixed preview column width (Phase 2
// visual redesign). `min()` with the settings feature's user-adjustable
// "Reading width" (ch) preference means the setting can still narrow the
// column below 680px, but can no longer widen it past the design's column —
// the preference isn't lost, just capped at this phase's fixed pane width.
const previewMaxWidth = 'min(680px, var(--md-reading-width, 75ch))'

// Reused below for the mermaid error box's heading — same semantic role
// (`hljs-deletion` and "diagram failed to render" are both an error
// accent), so this shares `deletionColor` rather than adding a second
// `ink('--color-error')` binding for the same colour.
</script>

<template>
  <!-- Root class/style are open for the parent to extend (Vue's default
       attribute fallthrough) — `layout/ui/PreviewPane.vue` adds `min-w-0
       flex-1` so this scroller sizes correctly inside its flex parent. -->
  <div ref="scroller" class="h-full overflow-y-auto print:h-auto print:overflow-visible">
    <div
      ref="content"
      class="markdown-preview prose prose-sm p-4 print:max-w-none print:p-0"
      :class="centered ? 'mx-auto' : 'max-w-none'"
      :style="centered ? { maxWidth: previewMaxWidth } : undefined"
      v-html="html"
    />
  </div>
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
  /* `--md-code` (`app/styles/main.css`, Phase 1 visual redesign) is the
   * reference design's dedicated code-block surface — distinct from
   * `--color-base-200` (used for the header/footer elsewhere), so a fenced
   * code block reads as its own surface rather than matching whatever
   * chrome happens to share `base-200`. */
  --tw-prose-pre-bg: var(--md-code);
}

.markdown-preview :deep(a) {
  word-break: break-word;
}

/* Modifier-click pane-jump's "landed here" flash (`src/app/paneJump.ts`,
 * toggles `.jump-flash` on the target `[data-line]` element). The
 * transition lives permanently on every `[data-line]` element — not scoped
 * to `.jump-flash` itself — so it's already active on both sides of the
 * class being added (fade in) and removed (fade out); scoping it inside
 * `.jump-flash` alone would mean it vanishes the instant that class is
 * removed, exactly when the fade-out needs it. `[data-line]` elements never
 * otherwise set a background, so the dormant `transition` here has nothing
 * else to affect. Gated behind `prefers-reduced-motion: no-preference` —
 * same rule, same reasoning, as the editor side's flash in
 * `features/editor/lib/theme.ts`. */
@media (prefers-reduced-motion: no-preference) {
  .markdown-preview :deep([data-line]) {
    transition: background-color 500ms ease-out;
  }
}

.markdown-preview :deep(.jump-flash) {
  background-color: color-mix(in oklab, var(--color-primary) 35%, transparent);
  border-radius: var(--radius-field, 0.375rem);
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

/* Export/PDF (`features/transfer`'s "Print / PDF"): scrollable overflow
 * regions don't paginate — a browser's print renderer only ever captures
 * a scroll container's visible viewport, not content a reader would have
 * had to scroll to reach, so a wide table or a long code block clipped by
 * `overflow-x: auto` above would print truncated. Printing switches both
 * back to normal flow: a table too wide for the page still overflows the
 * page edge (an accepted trade-off — there's no page-safe way to shrink
 * arbitrary tabular content), but nothing is silently cut off, and a code
 * block wraps instead of needing horizontal scroll it'll never get on
 * paper.
 */
@media print {
  .markdown-preview :deep(table) {
    display: table;
    overflow-x: visible;
  }

  .markdown-preview :deep(pre) {
    overflow-x: visible;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .markdown-preview :deep(.mermaid-diagram) {
    overflow-x: visible;
  }
}

/* Mermaid diagrams (`lib/mermaidRenderer.ts`) — rendered post-insertion,
 * so this component never sees the actual `<svg>` markup at author time,
 * only the two classNames that module hands out. `not-prose` (applied by
 * the renderer itself, see that file) already keeps `prose`'s own
 * element-tag selectors from reaching in here, so every rule needed for
 * this content lives in this one block instead of being scattered across
 * `prose` overrides above.
 *
 * `overflow-x: auto`, `display: block`: the same wide-content treatment
 * `table`/`pre` already get above — a diagram can be considerably wider
 * than the pane, and this is what keeps that scroll contained to the
 * diagram itself rather than dragging the whole preview pane sideways
 * (see the `table` rule's comment for why `display: block` is what makes
 * `overflow-x` apply at all here). Margin matches `prose`'s own rhythm
 * between block-level children so a diagram doesn't visually collide with
 * the text around it despite opting out of `prose` itself. */
.markdown-preview :deep(.mermaid-diagram) {
  display: block;
  overflow-x: auto;
  margin: 1em 0;
}

.markdown-preview :deep(.mermaid-diagram__output svg) {
  max-width: none;
  height: auto;
}

/* Invalid/half-typed mermaid syntax (`renderErrorInto` in
 * `lib/mermaidRenderer.ts`) — every piece of text here was built with
 * `textContent`, not `innerHTML`, by that function, specifically because
 * it can contain the untrusted, still-being-typed diagram source; this
 * block is purely presentational. */
.markdown-preview :deep(.mermaid-diagram__error) {
  border: 1px solid var(--color-base-300);
  border-radius: var(--radius-box, 0.5rem);
  background: var(--color-base-200);
  padding: 0.75em 1em;
}

.markdown-preview :deep(.mermaid-diagram__error-heading) {
  margin: 0;
  font-weight: 600;
  color: v-bind(deletionColor);
}

.markdown-preview :deep(.mermaid-diagram__error-detail) {
  margin: 0.35em 0 0;
  font-size: 0.875em;
  color: var(--color-base-content);
}

.markdown-preview :deep(.mermaid-diagram__error-source) {
  margin: 0.6em 0 0;
  overflow-x: auto;
  border-radius: var(--radius-field, 0.375rem);
  background: var(--color-base-300);
  padding: 0.6em 0.8em;
  font-size: 0.85em;
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

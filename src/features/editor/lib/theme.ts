import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

import { ink } from '@/shared/lib/ink'

/**
 * Editor chrome (background, gutters, cursor, selection) built entirely
 * from DaisyUI's CSS custom properties. DaisyUI redefines these variables
 * on `<html data-theme="...">`, so this theme re-paints itself the moment
 * the attribute changes — no Compartment swap, no remount, no JS needed
 * to react to a theme toggle.
 */
export const daisyEditorTheme = EditorView.theme({
  '&': {
    color: 'var(--color-base-content)',
    backgroundColor: 'var(--color-base-100)',
    height: '100%',
  },
  // `--md-editor-font-size`/`--md-editor-font-family` are the settings
  // feature's persisted font preferences (`editorPreferences.ts`), applied
  // to `<html>` as custom properties — the fallbacks here are only the
  // pre-Step-8 defaults, kept so this theme still renders sensibly if that
  // effect somehow hasn't run yet. The fallback family now leads with the
  // self-hosted IBM Plex Mono (`app/styles/main.css`'s `@fontsource`
  // imports) instead of the system stack — `editorPreferences.ts`'s own
  // `FONT_FAMILY_STACKS.mono` leads with it too, so this only matters
  // before that effect has run, same as before.
  //
  // Line-height 1.85 and the slight negative letter-spacing are the
  // reference design's editor type scale (`design-template.html`'s
  // `<textarea>` rule) — fixed here rather than exposed as a setting,
  // unlike font-size/family which stay user-adjustable.
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily:
      'var(--md-editor-font-family, "IBM Plex Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace)',
    fontSize: 'var(--md-editor-font-size, 14.5px)',
    lineHeight: '1.85',
    letterSpacing: '-0.005em',
  },
  '.cm-content': {
    // The reference design's caret is the theme accent (`--acc` ->
    // `--md-accent` here), not the body text colour — a thin gold/brown
    // line reads more clearly as "cursor" against body text than one more
    // `base-content`-coloured mark blending into the text around it.
    // `--md-accent`, not `--color-primary`: the caret is a bare foreground
    // mark drawn directly on the pane background, not a fill something else
    // sits on top of — see "PRIMARY SURFACE/ACCENT SPLIT — Phase 4" in
    // `app/styles/main.css`.
    caretColor: 'var(--md-accent)',
    padding: '1rem 0',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor:
      'color-mix(in srgb, color-mix(in oklab, var(--md-accent) 60%, var(--color-base-content)) 55%, transparent)',
  },
  '.cm-line': {
    padding: '0 1rem',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  // Modifier-click pane-jump's "landed here" flash (`lib/jumpFlash.ts`,
  // `src/app/paneJump.ts`). The transition lives permanently on `.cm-line`
  // itself — not scoped to `.cm-jump-flash` — so it's already in effect on
  // *both* sides of the class being added (fade in) and removed (fade
  // out); a transition declared only inside `.cm-jump-flash` would vanish
  // the instant that class is removed, which is exactly the moment the
  // fade-out needs it. Gated behind `prefers-reduced-motion: no-preference`
  // so a reduced-motion user gets an instant on/off instead of an animated
  // fade — the highlight itself still appears and clears either way (see
  // `flashLine`'s hold timer in `lib/scrollHandle.ts`), only the motion is
  // skipped.
  '@media (prefers-reduced-motion: no-preference)': {
    '.cm-line': {
      transition: 'background-color 500ms ease-out',
    },
  },
  '.cm-jump-flash': {
    backgroundColor: 'color-mix(in oklab, var(--color-primary) 35%, transparent)',
  },
})

/**
 * Syntax colours mapped onto DaisyUI's semantic palette rather than fixed
 * hues, so highlighting stays on-theme for any DaisyUI theme (light,
 * dark, or a custom one) without maintaining a parallel colour table.
 */
export const daisyHighlightStyle = HighlightStyle.define([
  { tag: t.heading, color: ink('--md-accent'), fontWeight: 'bold' },
  { tag: t.strong, color: 'var(--color-base-content)', fontWeight: 'bold' },
  { tag: t.emphasis, color: 'var(--color-base-content)', fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: ink('--color-info'), textDecoration: 'underline' },
  { tag: t.url, color: ink('--color-info') },
  { tag: t.quote, color: 'var(--color-base-content)', opacity: '0.7', fontStyle: 'italic' },
  { tag: t.monospace, color: ink('--color-accent') },
  { tag: t.processingInstruction, color: ink('--color-secondary') },
  { tag: t.contentSeparator, color: ink('--color-secondary') },
  { tag: t.meta, color: 'var(--color-base-content)', opacity: '0.5' },
  { tag: t.comment, color: 'var(--color-base-content)', opacity: '0.5', fontStyle: 'italic' },
  { tag: t.keyword, color: ink('--md-accent') },
  { tag: t.operator, color: 'var(--color-base-content)', opacity: '0.8' },
  { tag: t.string, color: ink('--color-success') },
  { tag: t.number, color: ink('--color-secondary') },
  { tag: t.bool, color: ink('--color-secondary') },
  { tag: t.null, color: ink('--color-secondary') },
  { tag: [t.className, t.typeName], color: ink('--color-warning') },
  { tag: [t.propertyName, t.attributeName], color: ink('--color-accent') },
  { tag: t.function(t.variableName), color: ink('--color-info') },
  { tag: t.definition(t.variableName), color: 'var(--color-base-content)' },
  { tag: t.variableName, color: 'var(--color-base-content)' },
  { tag: t.invalid, color: ink('--color-error') },
])

export const daisyMarkdownTheme = [daisyEditorTheme, syntaxHighlighting(daisyHighlightStyle)]

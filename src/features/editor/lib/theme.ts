import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

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
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    fontSize: '0.875rem',
    lineHeight: '1.6',
  },
  '.cm-content': {
    caretColor: 'var(--color-base-content)',
    padding: '1rem 0',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor:
      'color-mix(in srgb, color-mix(in oklab, var(--color-primary) 60%, var(--color-base-content)) 55%, transparent)',
  },
  '.cm-line': {
    padding: '0 1rem',
  },
  '&.cm-focused': {
    outline: 'none',
  },
})

/**
 * DaisyUI's semantic accent roles (--color-accent, --color-info, etc.) are
 * defined as button *background* colours — identical in light and dark
 * themes, meant to pair with --color-*-content text. Used directly as
 * foreground text on --color-base-100 they fail WCAG AA contrast on the
 * light theme. Mixing them toward --color-base-content keeps the semantic
 * role concept and stays theme-adaptive without hardcoding hex values.
 */
const ink = (varName: string) =>
  `color-mix(in oklab, var(${varName}) 60%, var(--color-base-content))`

/**
 * Syntax colours mapped onto DaisyUI's semantic palette rather than fixed
 * hues, so highlighting stays on-theme for any DaisyUI theme (light,
 * dark, or a custom one) without maintaining a parallel colour table.
 */
export const daisyHighlightStyle = HighlightStyle.define([
  { tag: t.heading, color: ink('--color-primary'), fontWeight: 'bold' },
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
  { tag: t.keyword, color: ink('--color-primary') },
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

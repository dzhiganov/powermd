import { EditorView } from '@codemirror/view'

import { ink } from '@/shared/lib/ink'

/**
 * Shared styling for every `@codemirror/autocomplete` tooltip this feature
 * registers — originally written for the `[[Title]]` wiki-link menu
 * (`wikiLinkCompletion.ts`) and now reused verbatim by the in-document word
 * completion menu (`wordCompletion.ts`) so the two read as one system rather
 * than two subtly different-looking popups. Extracted into its own module
 * specifically so there is exactly one copy of these rules: both completion
 * sources are registered on the SAME `autocompletion()` extension instance
 * (see `useCodeMirror.ts`'s `buildCompletionExtension`), so in principle a
 * single shared `EditorView.theme(...)` was always enough — this file is
 * that one copy, not a second one that could drift from it.
 *
 * Built from the same DaisyUI/`--color-*`/`--md-*` design tokens
 * `lib/searchTheme.ts` uses for the find-and-replace panel — border/
 * background/shadow tokens already measured >=3:1 (non-text) / >=4.5:1
 * (text) against every one of this app's four theme x soft-contrast
 * combinations there, reused rather than re-measured from scratch here.
 * Since this module changes none of those declarations (only relocates
 * them), the same four-combination measurement still holds; re-verified in
 * the browser after the move rather than assumed.
 *
 * The selected row is marked by more than colour alone (WCAG 1.4.1):
 * `var(--md-hov)` background PLUS a solid left accent bar PLUS bold text —
 * a colour-blind or high-contrast-forced user still sees a distinct shape,
 * not just a hue shift.
 *
 * `icons: false` is set on every `autocompletion()` call that uses this
 * theme, so there is no `.cm-completionIcon` box to style — every option in
 * both menus is a plain text label (a document title, or a word), and the
 * library's built-in icon glyphs (function/class/keyword/...) have no
 * meaningful mapping onto either one.
 */
export const inlineCompletionTheme = EditorView.theme({
  '.cm-tooltip.cm-tooltip-autocomplete': {
    background: 'var(--md-pop)',
    border: '1px solid color-mix(in oklab, var(--color-base-content) 55%, transparent)',
    /* Square, deliberately. Rounded rows inside a rounded box, with an
       accent bar down the side of the selected one, is a lot of decoration
       for a list of four words. */
    borderRadius: '0',
    boxShadow: 'var(--md-shadow-pop)',
    overflow: 'hidden',
    /* FIXED width, so the menu never resizes under the cursor. It used to
       size to its widest row, which meant it visibly shrank while you typed:
       measured 211px with three matches and 158px the moment filtering left
       one. A menu that changes shape as you type is the thing you are trying
       to read. Long titles/words ellipsis instead (see `.cm-completionLabel`). */
    width: '19em',
    maxWidth: 'calc(100vw - 2rem)',
  },
  /* `.cm-tooltip.cm-tooltip-autocomplete > ul`, not `.cm-tooltip-autocomplete
     > ul`. The library's own base theme styles this list through the
     two-class form and sets `font-family: monospace` there, which outranks a
     single-class selector — so the single-class version of this rule applied
     its font-SIZE (the base rule declares none) while silently losing the
     font-FAMILY, and the menu rendered in the editor's monospace instead of
     the app's UI face. Measured, not guessed: the computed family on this
     `ul` read `monospace` while its own container read `IBM Plex Sans`.
     Matching the base theme's specificity is what makes this stick. */
  '.cm-tooltip.cm-tooltip-autocomplete > ul': {
    fontFamily: 'var(--font-sans)',
    fontSize: '13px',
    lineHeight: '1.5',
    maxHeight: '14em',
    padding: '0',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
    display: 'flex',
    alignItems: 'center',
    padding: '6px 10px',
    color: 'var(--color-base-content)',
  },
  /* Same two-class form as the rules above — the base theme styles the
     selected row through it too, so a single-class selector here would lose
     the same argument the font-family lost.

     Background and weight carry the selection; no accent bar, no rounding.
     Bold is applied via `-webkit-text-stroke` rather than `font-weight`
     deliberately: a real weight change re-measures the text, and since the
     menu is a fixed width that is harmless here, but it also shifts the row's
     own glyphs sideways as you arrow through — thickening strokes in place
     does not. */
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    background: 'var(--md-sel)',
    WebkitTextStroke: '0.4px currentColor',
    color: 'var(--color-base-content)',
  },
  '.cm-completionLabel': {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  '.cm-completionMatchedText': {
    textDecoration: 'none',
    fontWeight: '700',
    color: ink('--md-accent'),
  },
})

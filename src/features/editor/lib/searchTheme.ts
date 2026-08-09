import { EditorView } from '@codemirror/view'

import { ink } from '@/shared/lib/ink'

/**
 * Styling for the in-file find & replace panel (`@codemirror/search`'s
 * `search()` extension, custom panel in `./search.ts`) — built entirely
 * from the same DaisyUI/`--md-*` custom properties `lib/theme.ts` already
 * uses for the editor chrome, so the panel repaints with the rest of the
 * app on a theme/soft-contrast change with no JS involved, same mechanism
 * as `daisyEditorTheme`.
 *
 * The panel's own root element (`.md-search-panel`, built in `./search.ts`)
 * deliberately does NOT carry `@codemirror/search`'s own `cm-search` class
 * — that class is only meaningful to the *library's own* `baseTheme`
 * (`.cm-panel.cm-search{...}`, shipped unconditionally by `search()`
 * regardless of a custom `createPanel`), which sets `input`/`button`/
 * `label` margins by bare tag name. Reusing that class would mean this
 * theme's rules and the library's tag-selector rules have equal
 * specificity and fight over cascade order for every field in the panel.
 * Skipping the class sidesteps the fight entirely: the library's
 * `.cm-panel.cm-search` selector simply never matches this panel, so every
 * spacing/layout rule here is the only one in effect.
 *
 * `.cm-searchMatch`/`.cm-searchMatch-selected` (the yellow/cyan highlight
 * on matches, applied by the search extension's decorations regardless of
 * which panel is in use) are the one part of the library's `baseTheme` that
 * still matters here — but that theme only paints them under `&light`/
 * `&dark` (CodeMirror's OWN light/dark facet, toggled by passing
 * `{dark: true}` to `EditorView.theme`, which this app never does — see
 * `lib/theme.ts`'s doc comment: theming here is 100% CSS custom properties
 * on `<html data-theme>`, not CodeMirror's built-in facet). Those
 * `&light`/`&dark`-qualified rules never match anything in this app, so the
 * plain (unqualified) rules below are the *only* source of a match
 * background here — no cascade race to win.
 */
export const searchPanelTheme = EditorView.theme({
  '.md-search-panel': {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '8px 34px 8px 10px',
    position: 'relative',
    background: 'var(--md-pop)',
    borderBottom: '1px solid var(--color-base-300)',
    boxShadow: 'var(--md-shadow-pop)',
    fontFamily: 'var(--font-sans)',
    fontSize: '12.5px',
    color: 'var(--color-base-content)',
  },
  '.md-search-row': {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '6px',
  },
  '.md-search-field': {
    boxSizing: 'border-box',
    minWidth: '140px',
    flex: '1 1 160px',
    margin: 0,
    padding: '4px 8px',
    borderRadius: '6px',
    // NOT `--color-base-300` (the app's usual hairline border, e.g. every
    // dialog's outer edge) — that token is documented in `app/styles/
    // main.css` as a deliberately subtle ~1.1-1.3:1 boundary, well under
    // the 3:1 non-text floor. Fine for a decorative panel edge that already
    // has other cues (a shadow, a background change), not fine for an
    // actual form control's own outline, which is the one thing telling
    // the user "this is a text field, click here" — so these get their own
    // stronger, formula-based border instead: measured >=3:1 against every
    // one of this app's four theme/soft-contrast surface combinations (see
    // the task report), the same "mix toward base-content" shape `ink()`
    // (`shared/lib/ink.ts`) already uses for accent text, just applied to
    // a border instead.
    border: '1px solid color-mix(in oklab, var(--color-base-content) 55%, transparent)',
    background: 'var(--color-base-100)',
    color: 'var(--color-base-content)',
    fontFamily: 'inherit',
    fontSize: '12.5px',
    outline: 'none',
  },
  '.md-search-field:focus-visible': {
    outline: '2px solid var(--md-accent)',
    outlineOffset: '-1px',
  },
  '.md-search-count': {
    minWidth: '4.5em',
    fontSize: '11px',
    color: ink('--md-t2'),
    whiteSpace: 'nowrap',
  },
  '.md-search-button': {
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '24px',
    minWidth: '24px',
    margin: 0,
    padding: '0 8px',
    borderRadius: '6px',
    // Same reasoning/measurement as `.md-search-field`'s border above.
    border: '1px solid color-mix(in oklab, var(--color-base-content) 55%, transparent)',
    background: 'var(--md-seg)',
    color: 'var(--color-base-content)',
    fontFamily: 'inherit',
    fontSize: '11.5px',
    cursor: 'pointer',
  },
  '.md-search-button:hover': {
    background: 'var(--md-hov)',
  },
  '.md-search-button:focus-visible': {
    outline: '2px solid var(--md-accent)',
    outlineOffset: '1px',
  },
  '.md-search-check': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    margin: 0,
    fontSize: '11.5px',
    color: ink('--md-t2'),
    whiteSpace: 'pre',
    cursor: 'pointer',
    userSelect: 'none',
  },
  '.md-search-checkbox': {
    width: '13px',
    height: '13px',
    margin: 0,
    accentColor: 'var(--md-accent)',
    cursor: 'pointer',
  },
  '.md-search-close': {
    position: 'absolute',
    top: '6px',
    right: '6px',
    boxSizing: 'border-box',
    minHeight: '24px',
    minWidth: '24px',
    margin: 0,
    padding: 0,
    border: 'none',
    borderRadius: '6px',
    background: 'transparent',
    color: ink('--md-t2'),
    fontFamily: 'inherit',
    fontSize: '15px',
    lineHeight: 1,
    cursor: 'pointer',
  },
  '.md-search-close:hover': {
    background: 'var(--md-hov)',
  },
  '.md-search-close:focus-visible': {
    outline: '2px solid var(--md-accent)',
    outlineOffset: '1px',
  },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in oklab, var(--md-accent) 35%, transparent)',
  },
  '.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in oklab, var(--color-primary) 55%, transparent)',
  },
  // The panel must never appear in printed output — same
  // `print:hidden`-equivalent rule every other floating UI surface in this
  // app carries (see `AppShell.vue`, `DocumentDrawer.vue`, the settings/
  // shortcuts/about dialogs), just expressed as plain CSS here since this
  // panel's DOM is built imperatively by CodeMirror, not Vue template
  // classes Tailwind's content scanner would see.
  '@media print': {
    '.md-search-panel': {
      display: 'none',
    },
  },
})

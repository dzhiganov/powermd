import { Prec } from '@codemirror/state'
import { keymap, type KeyBinding } from '@codemirror/view'

import { toggleWrapInline, toggleLink } from './formatting'
import { saveNowRequested, viewModeCycleRequested, helpRequested } from '../model/editorEvents'
import { bookmarkJumpRequested, bookmarkToggleAtCursorRequested } from '../model/bookmarks'

export interface EditorShortcut {
  /** CodeMirror key-binding string, e.g. `"Mod-b"`. `Mod` is CodeMirror's
   * own cross-platform alias — Cmd on macOS, Ctrl everywhere else. */
  keys: string
  description: string
}

/** Single source of truth for the editor's keyboard shortcuts: both the
 * live CodeMirror keymap below and the help modal (`features/settings`'
 * `ShortcutsModal.vue`, via `EDITOR_SHORTCUTS`) are built from this list,
 * so they can never drift apart.
 *
 * Two entries are exceptions, listed here purely so the help modal
 * documents them via this one list instead of a second one — neither has
 * an entry in `bindings` below:
 *   - `Mod-Click`: a mouse gesture (the modifier-click pane jump, wired in
 *     `src/app/paneJump.ts` since it spans the editor *and* preview
 *     panes), not a keyboard binding at all.
 *   - `Tab`/`Shift-Tab`: list-item indent/outdent, bound in
 *     `useCodeMirror.ts`'s `listIndentKeymap` (see `lib/listIndent.ts`) —
 *     kept out of `bindings` because that keymap has to sit at a specific
 *     position in `createState`'s extension list (after
 *     `completionAcceptKeymap`, so an open completion menu keeps winning
 *     Tab first), not wherever `editorShortcutsKeymap`'s own `Prec.highest`
 *     placement would put it.
 * `formatShortcut` (`shared/lib/platform.ts`) still renders both sensibly:
 * `Mod` resolves to ⌘/Ctrl exactly like every other entry, `Click` (not a
 * single character, not a recognised modifier) passes through unchanged,
 * and `Tab` does too. */
export const EDITOR_SHORTCUTS: EditorShortcut[] = [
  { keys: 'Mod-b', description: 'Bold' },
  { keys: 'Mod-i', description: 'Italic' },
  { keys: 'Mod-u', description: 'Underline' },
  { keys: 'Mod-Shift-x', description: 'Strikethrough' },
  { keys: 'Mod-k', description: 'Insert link' },
  { keys: 'Tab', description: 'Indent list item' },
  { keys: 'Shift-Tab', description: 'Outdent list item' },
  { keys: 'Mod-s', description: 'Save now' },
  { keys: 'Mod-Shift-v', description: 'Toggle view mode' },
  { keys: 'Mod-/', description: 'Open keyboard shortcuts help' },
  // `Alt-Shift-b`, not `Mod-Shift-b` — Ctrl/Cmd-Shift-B is Chrome's own
  // "toggle bookmarks bar" shortcut; binding the same chord here would
  // either lose the keypress to the browser or fight it, depending on the
  // platform. `Alt-Shift` has no such reserved meaning in mainstream
  // browsers.
  { keys: 'Alt-Shift-b', description: 'Toggle bookmark on the current line' },
  { keys: 'Mod-Shift-ArrowDown', description: 'Jump to the next bookmark' },
  { keys: 'Mod-Shift-ArrowUp', description: 'Jump to the previous bookmark' },
  { keys: 'Mod-Click', description: 'Jump to the matching line in the other pane' },
]

const bindings: KeyBinding[] = [
  {
    key: 'Mod-b',
    preventDefault: true,
    run: (view) => {
      toggleWrapInline(view, '**')
      return true
    },
  },
  {
    key: 'Mod-i',
    preventDefault: true,
    run: (view) => {
      toggleWrapInline(view, '*')
      return true
    },
  },
  {
    // Markdown has no underline, so this is the one formatting action that
    // emits raw HTML rather than markup. `<u>` is allow-listed in the
    // preview's sanitize schema for exactly this; nothing else about the
    // security boundary changes.
    key: 'Mod-u',
    preventDefault: true,
    run: (view) => {
      toggleWrapInline(view, '<u>', '</u>')
      return true
    },
  },
  {
    // Mod-Shift-x, the same chord GitHub, Obsidian and Notion use for
    // strikethrough — worth matching rather than inventing.
    key: 'Mod-Shift-x',
    preventDefault: true,
    run: (view) => {
      toggleWrapInline(view, '~~')
      return true
    },
  },
  {
    key: 'Mod-k',
    preventDefault: true,
    run: (view) => {
      toggleLink(view)
      return true
    },
  },
  {
    key: 'Mod-s',
    preventDefault: true,
    run: () => {
      saveNowRequested()
      return true
    },
  },
  {
    key: 'Mod-Shift-v',
    preventDefault: true,
    run: () => {
      viewModeCycleRequested()
      return true
    },
  },
  {
    key: 'Mod-/',
    preventDefault: true,
    run: () => {
      helpRequested()
      return true
    },
  },
  {
    // The keyboard-only equivalent of a gutter click — see
    // `bookmarkToggleAtCursorRequested`'s own doc comment
    // (`model/bookmarks.ts`) for why this exists at all: a keyboard user
    // has no gutter to click. `line.from`, not the raw cursor offset — same
    // anchor shape a mouse gutter click uses (`lib/bookmarkGutter.ts`), so
    // the two paths always produce identically-anchored bookmarks. See
    // `EDITOR_SHORTCUTS`' own entry above for why this is `Alt-Shift-b`,
    // not `Mod-Shift-b`.
    key: 'Alt-Shift-b',
    preventDefault: true,
    run: (view) => {
      const line = view.state.doc.lineAt(view.state.selection.main.head)
      bookmarkToggleAtCursorRequested(line.from)
      return true
    },
  },
  {
    key: 'Mod-Shift-ArrowDown',
    preventDefault: true,
    run: () => {
      bookmarkJumpRequested('next')
      return true
    },
  },
  {
    key: 'Mod-Shift-ArrowUp',
    preventDefault: true,
    run: () => {
      bookmarkJumpRequested('previous')
      return true
    },
  },
]

/**
 * Registered as a genuine CodeMirror `keymap` extension (not a global
 * `window`/`document` listener) so every binding only ever fires while the
 * editor's own `contentDOM` has focus — typing in the document-rename input
 * or a settings field never triggers it. Wrapped in `Prec.highest` so these
 * bindings win over `@codemirror/commands`' `defaultKeymap`/`historyKeymap`
 * (also registered in `lib/useCodeMirror.ts`) for the same key combo, should
 * one ever collide.
 */
export const editorShortcutsKeymap = Prec.highest(keymap.of(bindings))

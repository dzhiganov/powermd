import { isMac } from '@/shared/lib/platform'
import { $zenMode, zenToggled, zenExited } from '@/features/layout'

/**
 * `Mod-.` toggles Zen mode; `Escape` exits it while it's on. Both are
 * app-wide — a single `window`-level listener, not a CodeMirror `keymap`
 * entry (contrast every other shortcut in `features/editor/lib/
 * shortcuts.ts`) — because Zen mode has to be reachable regardless of what
 * currently has focus: the document list, a settings field, or nothing at
 * all, not just the editor. `Mod-.` is not bound by CodeMirror's own
 * `defaultKeymap`/`historyKeymap` or by `editorShortcutsKeymap`, so this
 * never fights either while the editor itself is focused — the keydown
 * simply bubbles up to this listener untouched, same as any other unbound
 * key. `EDITOR_SHORTCUTS` in `features/editor/lib/shortcuts.ts` still lists
 * it (for the shortcuts help modal), the same "documented but not a real
 * CodeMirror `KeyBinding`" exception that list already makes for
 * `Mod-Click`.
 *
 * Escape exiting zen mode is intentionally independent of any open dialog's
 * own `@keydown.esc` handler (every dialog in this app closes itself that
 * way, scoped to focus within the dialog) — if both a dialog and zen mode
 * happen to be active at once, one Escape press closing the dialog *and*
 * exiting zen is acceptable overlap, not a conflict: neither handler
 * prevents the other from also responding.
 */
function isZenToggleShortcut(event: KeyboardEvent): boolean {
  if (event.key !== '.' || event.shiftKey || event.altKey) return false
  return isMac() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
}

export function initZenShortcut(): void {
  window.addEventListener('keydown', (event) => {
    if (isZenToggleShortcut(event)) {
      event.preventDefault()
      zenToggled()
      return
    }
    if (event.key === 'Escape' && $zenMode.getState()) {
      zenExited()
    }
  })
}

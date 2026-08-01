/**
 * Mac uses Cmd for the primary modifier and displays it as symbols; every
 * other platform uses Ctrl and spells shortcuts out. CodeMirror's own `Mod-`
 * keymap alias already resolves to the right physical key at binding time —
 * this is only for *displaying* that binding in the help modal.
 */
export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false
  const platform = navigator.platform ?? navigator.userAgent
  return /Mac|iPod|iPhone|iPad/.test(platform)
}

const SYMBOLS: Record<string, string> = {
  Mod: '⌘',
  Shift: '⇧',
  Alt: '⌥',
}

const WORDS: Record<string, string> = {
  Mod: 'Ctrl',
  Shift: 'Shift',
  Alt: 'Alt',
}

/**
 * Formats a CodeMirror-style key binding string (e.g. `"Mod-Shift-v"`) for
 * display: `"⌘⇧V"` on macOS, `"Ctrl+Shift+V"` elsewhere.
 */
export function formatShortcut(keys: string): string {
  const mac = isMac()
  const parts = keys.split('-')
  const formatted = parts.map((part) => {
    const table = mac ? SYMBOLS : WORDS
    if (part in table) return table[part]
    return part.length === 1 ? part.toUpperCase() : part
  })
  return mac ? formatted.join('') : formatted.join('+')
}

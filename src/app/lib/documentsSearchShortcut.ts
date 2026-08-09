/**
 * The pure "does this keydown match Ctrl+Shift+F/Cmd+Shift+F" check for
 * `../documentsSearchShortcut.ts`'s global shortcut, split into its own
 * zero-import module so it's testable in isolation: `../
 * documentsSearchShortcut.ts` itself imports `@/features/documents` (for
 * the `drawerOpened`/`searchFocusRequested` events it fires), which
 * re-exports `DocumentDrawer.vue` from that feature's `index.ts` — pulling
 * that in transitively breaks under this project's deliberately
 * DOM/Vue-plugin-free `vitest.config.ts` (no jsdom, no `@vitejs/plugin-vue`
 * — see that file's own comment). Keeping the pure check here, with no
 * imports of its own, means `documentsSearchShortcut.test.ts` can import
 * *only* this file and never touches that chain — the same "test the pure
 * `lib/` function directly, not the feature that wires it up" shape
 * `features/github/lib/*.test.ts` already uses.
 */

/** The subset of `KeyboardEvent` the check below actually reads — a real
 * `KeyboardEvent` satisfies this structurally, so the real listener in
 * `../documentsSearchShortcut.ts` needs no cast, while the test for this
 * file can exercise it with plain object literals instead of constructing
 * real `KeyboardEvent`s. */
export interface ModifierKeyEvent {
  key: string
  altKey: boolean
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}

/**
 * Chosen over `event.code`/exact key-combo libraries: `ctrlKey`/`metaKey`/
 * `shiftKey` plus `event.key` is the same low-level shape `paneJump.ts`'s
 * `isJumpClick` already uses for a modifier check, just for a keyboard
 * event instead of a mouse one. Either `ctrlKey` or `metaKey` is accepted
 * (not "exactly one, per-platform") — same reasoning `isJumpClick` doesn't
 * need here: this is a global keyboard shortcut, not a mouse gesture that
 * has to avoid double-firing across platforms, so there's no harm in
 * accepting whichever modifier the user's platform (or a remapped
 * keyboard) actually sends.
 */
export function isDocumentsSearchShortcut(event: ModifierKeyEvent): boolean {
  if (event.altKey || !event.shiftKey) return false
  if (!event.ctrlKey && !event.metaKey) return false
  return event.key.toLowerCase() === 'f'
}

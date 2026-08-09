import { drawerOpened, searchFocusRequested } from '@/features/documents'

import { isDocumentsSearchShortcut } from './lib/documentsSearchShortcut'

/**
 * Ctrl+Shift+F (Cmd+Shift+F on macOS) — jumps to the `documents` feature's
 * existing across-documents search (`DocumentDrawer.vue`'s search box,
 * `features/documents/model/search.ts`), opening the drawer first if it was
 * closed. A plain `window` `keydown` listener, not a CodeMirror `keymap`
 * binding: unlike in-file find (`features/editor/lib/search.ts`, which
 * deliberately only fires while the editor itself has focus, see that
 * file's doc comment), this shortcut has to work everywhere in the app —
 * whether the editor is focused, the preview pane is showing, or nothing
 * has focus at all — because searching across documents isn't specific to
 * being inside the editor. `editor` and `documents` never import each
 * other; this file (parallel to `paneJump.ts`/`urlSync.ts`) is what
 * connects a cross-cutting shortcut to `documents`' public API, called once
 * from `wiring.ts`, the one place that already does this for every other
 * cross-feature link.
 *
 * Not registered as a CodeMirror binding for another reason too: Ctrl+F
 * (in-file find) and Ctrl+Shift+F (this) need to keep working independently
 * of each other regardless of where focus is, and CodeMirror's `keymap`
 * facet has no reach outside `contentDOM` at all — a `window` listener is
 * the only mechanism that can see the keystroke everywhere.
 *
 * The actual key-combo check (`isDocumentsSearchShortcut`) lives in
 * `./lib/documentsSearchShortcut.ts` instead of inline here — see that
 * file's own doc comment for why (this file imports `@/features/documents`,
 * which the pure check needs to stay free of to be unit-testable under this
 * project's DOM-free `vitest.config.ts`).
 */
export function initDocumentsSearchShortcut(): void {
  window.addEventListener('keydown', (event) => {
    if (!isDocumentsSearchShortcut(event)) return
    event.preventDefault()
    // Unconditional, not "only if closed": `drawerOpened` is a no-op when
    // the drawer is already open (see its own doc comment in
    // `features/documents/model/documents.ts`), so this always ends up
    // open regardless of the starting state — no branch needed here.
    drawerOpened()
    searchFocusRequested()
  })
}

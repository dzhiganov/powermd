import { createEvent, createStore } from 'effector'

import { $editorScrollHandle, type EditorScrollHandle } from '@/features/editor'
import { $previewScrollHandle, type PreviewScrollHandle } from '@/features/preview'
import { $showEditor, $showPreview } from '@/features/layout'

import { createSyncSession } from '../lib/syncSession'

interface Session {
  editor: EditorScrollHandle
  preview: PreviewScrollHandle
  teardown: () => void
}

/** Module-scope (not local to `initScrollSync`) so `evaluate` can be called
 * from every watcher below without threading session state back out. There
 * is only ever one session for the app's lifetime (one editor, one
 * preview), so a single module-level binding is the whole state that needs
 * sharing. */
let activeSession: Session | null = null

/**
 * Whether scroll sync is turned on at all — a `settings`-owned persisted
 * preference (`$scrollSyncEnabled` in `features/settings/model/
 * uiPreferences.ts`), mirrored here the same way `documents/model/
 * documents.ts` mirrors the autosave interval: `settings` never imports the
 * feature that acts on a preference, so `src/app/wiring.ts` feeds this
 * store from the persisted one via `scrollSyncEnabledChanged` (one kick at
 * startup, then a `sample` on every later change).
 *
 * Defaults OFF — the user does not want the editor/preview panes to follow
 * each other. When off, `evaluate` below never creates a session at all: no
 * scroll listeners are attached, no anchor table is built, no work happens
 * on scroll. Toggling it on with both panes already visible builds the
 * session immediately (the same `evaluate` this store's own `.watch` below
 * triggers); toggling it off tears an active session down immediately.
 */
export const scrollSyncEnabledChanged = createEvent<boolean>()
export const $scrollSyncEnabled = createStore<boolean>(false).on(
  scrollSyncEnabledChanged,
  (_, enabled) => enabled,
)

/**
 * Starts watching the editor/preview scroll handles, each pane's actual
 * visibility, and the scroll-sync-enabled preference, attaching a sync
 * session only while the setting is on, both handles exist, *and* both
 * panes are genuinely shown on screen — see `$showEditor`/`$showPreview` in
 * `layout/model/layout.ts`. Tears the session down the instant any of
 * those stops being true, and rebuilds it if a handle's identity ever
 * changes.
 *
 * Deliberately keyed off `$showEditor`/`$showPreview` rather than
 * `$viewMode === 'split'` or measuring the panes' DOM layout directly:
 *
 * - `$viewMode === 'split'` only means "the desktop toolbar is set to show
 *   both panes". Below the `md` breakpoint, `AppShell.vue` still keeps
 *   `$viewMode` at its default `'split'` (every first-time mobile visitor
 *   hits this) while `v-show`-hiding one pane per the mobile tab, so a pane
 *   can be in the DOM, wired up, and have no real scroll range at the same
 *   time `$viewMode` claims both panes are visible. `$showEditor`/
 *   `$showPreview` already fold in the desktop/mobile split (mirroring
 *   `AppShell.vue`'s own computeds), so checking both of them is enough —
 *   no separate `$viewMode === 'split'` check needed.
 * - Measuring `clientWidth`/`clientHeight` off the scroller DOM nodes
 *   instead of deriving visibility from state has its own failure mode:
 *   Effector propagates a store update to every `.watch` callback
 *   synchronously, ahead of Vue's own (microtask-deferred) render flush.
 *   A watcher that re-measures DOM layout right after a view-mode change
 *   can still see the *previous* frame's layout, with nothing left to
 *   prompt a re-check once Vue actually finishes patching. `$showEditor`/
 *   `$showPreview` are derived state, propagated through the same
 *   synchronous Effector update as everything else here, so there's no
 *   render-timing race to lose.
 *
 * Plain Effector store subscriptions rather than a Vue composable,
 * deliberately: nothing here needs component lifecycle or reactivity, only
 * "run this once at startup and react to store updates forever" — matching
 * how `src/app/wiring.ts` already wires the editor and preview features
 * together. Called once from that file.
 */
export function initScrollSync(): void {
  function evaluate(): void {
    const enabled = $scrollSyncEnabled.getState()
    const editor = $editorScrollHandle.getState()
    const preview = $previewScrollHandle.getState()
    const panesVisible =
      enabled &&
      editor !== null &&
      preview !== null &&
      $showEditor.getState() &&
      $showPreview.getState()

    const handlesChanged =
      activeSession !== null &&
      (activeSession.editor !== editor || activeSession.preview !== preview)

    if (!panesVisible || handlesChanged) {
      activeSession?.teardown()
      activeSession = null
    }

    if (panesVisible && !activeSession && editor && preview) {
      const { teardown } = createSyncSession(editor, preview)
      activeSession = { editor, preview, teardown }
    }
  }

  $editorScrollHandle.watch(evaluate)
  $previewScrollHandle.watch(evaluate)
  $showEditor.watch(evaluate)
  $showPreview.watch(evaluate)
  $scrollSyncEnabled.watch(evaluate)
}

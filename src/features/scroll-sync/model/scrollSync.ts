import { $editorScrollHandle, type EditorScrollHandle } from '@/features/editor'
import { $previewScrollHandle, type PreviewScrollHandle } from '@/features/preview'
import { $showEditor, $showPreview } from '@/features/layout'

import { createSyncSession } from '../lib/syncSession'

interface Session {
  editor: EditorScrollHandle
  preview: PreviewScrollHandle
  teardown: () => void
  claimPreview: () => void
}

/** Module-scope (not local to `initScrollSync`) so `claimPreviewScroll`
 * below — called from outside this module entirely, by the outline nav's
 * "click a heading" action — can reach whatever session is currently live,
 * without `initScrollSync` having to thread it back out itself. There is
 * only ever one session for the app's lifetime (one editor, one preview),
 * so a single module-level binding is the whole state that needs sharing. */
let activeSession: Session | null = null

/**
 * Starts watching the editor/preview scroll handles and each pane's actual
 * visibility, attaching a sync session only while both handles exist *and*
 * both panes are genuinely shown on screen — see `$showEditor`/
 * `$showPreview` in `layout/model/layout.ts`. Tears the session down the
 * instant either stops being true, and rebuilds it if a handle's identity
 * ever changes.
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
    const editor = $editorScrollHandle.getState()
    const preview = $previewScrollHandle.getState()
    const panesVisible =
      editor !== null && preview !== null && $showEditor.getState() && $showPreview.getState()

    const handlesChanged =
      activeSession !== null &&
      (activeSession.editor !== editor || activeSession.preview !== preview)

    if (!panesVisible || handlesChanged) {
      activeSession?.teardown()
      activeSession = null
    }

    if (panesVisible && !activeSession && editor && preview) {
      const { teardown, claimPreview } = createSyncSession(editor, preview)
      activeSession = { editor, preview, teardown, claimPreview }
    }
  }

  $editorScrollHandle.watch(evaluate)
  $previewScrollHandle.watch(evaluate)
  $showEditor.watch(evaluate)
  $showPreview.watch(evaluate)
}

/**
 * Hands preview-pane scroll ownership to `'preview'` without a real
 * pointer/keyboard event — see `SyncSession.claimPreview`'s doc comment in
 * `lib/syncSession.ts` for why that's what lets a single `scrollTop` write
 * afterwards drive the editor too, through the session's own already-wired
 * `scroll` listener. A no-op if scroll sync isn't currently active (editor-
 * only or preview-only view, or either pane not yet mounted) — the caller
 * (the outline nav's "click a heading" action) still scrolls the preview
 * itself in that case, just without the editor following, which is correct
 * since there is no editor pane visible to follow.
 */
export function claimPreviewScroll(): void {
  activeSession?.claimPreview()
}

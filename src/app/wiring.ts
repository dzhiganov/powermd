// Cross-feature Effector wiring lives here (e.g. `sample`s that connect
// events/stores from one feature to another), and this is also where the
// composition root owns model initialisation: importing a feature's
// public API here (rather than relying on it being pulled in transitively
// by some UI component) guarantees the model starts up regardless of
// which components end up rendered.
import { sample } from 'effector'

import {
  $content,
  contentChanged,
  loadContent,
  WELCOME_CONTENT,
  saveNowRequested,
  viewModeCycleRequested,
  helpRequested,
  lineWrapChanged,
} from '@/features/editor'
import { sourceReceived, renderMarkdownForExport } from '@/features/preview'
import { initScrollSync, scrollSyncEnabledChanged } from '@/features/scroll-sync'
import {
  initDocuments,
  activeDocumentEdited,
  activeDocumentLoaded,
  documentImported,
  documentOpenedFromOrigin,
  documentGithubSynced,
  documentRemoteApplied,
  documentSelected,
  documentCreated,
  documentDuplicated,
  drawerClosed,
  saveRequested,
  autosaveIntervalChanged,
  $activeId,
  $activeDocument,
} from '@/features/documents'
import { initTransfer, markdownFileImported, exportSourceChanged } from '@/features/transfer'
import {
  initGithub,
  fileOpened,
  commitSucceeded,
  remoteReloadRequested,
  activeDocumentForCommitChanged,
} from '@/features/github'
import { $viewMode, viewModeChanged, $isDesktop } from '@/features/layout'
import type { ViewMode } from '@/features/layout'
import {
  $lineWrapEnabled as $lineWrapPreference,
  $autosaveDebounceMs,
  $scrollSyncEnabled,
  helpOpened,
} from '@/features/settings'

import { initUrlSync } from './urlSync'
import { initPaneJump } from './paneJump'

import '@/features/settings'
import '@/features/editor'
import '@/features/preview'
import '@/features/documents'
import '@/features/transfer'
import '@/features/layout'
import '@/features/github'

// The preview feature never imports the editor feature (or vice versa) —
// this is the one place that's allowed to know both exist, and connects
// them: every `$content` update feeds the preview's `sourceReceived`
// input event, which the preview feature debounces and renders on its
// own.
sample({
  source: $content,
  target: sourceReceived,
})

// `sample` only reacts to `$content` *updates* — the value the store
// already holds when this module evaluates (starts as `''` until the
// documents feature's restore/seed loads the active document into it)
// doesn't count as one, so without this the preview would stay blank until
// the first `activeDocumentLoaded`. One explicit kick seeds it.
sourceReceived($content.getState())

// Bidirectional editor/preview scroll sync — connects the editor, preview,
// and layout features (view mode), so it lives here rather than inside any
// one of them. See `features/scroll-sync/model/scrollSync.ts`.
initScrollSync()

// Scroll sync is a `settings`-owned persisted preference, defaulted OFF —
// same one-kick-then-sample shape as `$lineWrapPreference`/
// `$autosaveDebounceMs` below: `scroll-sync` keeps its own live mirror
// store (`$scrollSyncEnabled` in `model/scrollSync.ts`) rather than reading
// `settings` directly, so the initial persisted/default value has to be
// pushed in explicitly before anything reacts to later toggles.
scrollSyncEnabledChanged($scrollSyncEnabled.getState())
sample({ clock: $scrollSyncEnabled, target: scrollSyncEnabledChanged })

// Modifier-click pane jump (editor <-> preview, via `scroll-sync`'s
// anchor/interpolation functions) — a separate, one-off counterpart to the
// continuous sync just above, deliberately independent of
// `$scrollSyncEnabled`. See `src/app/paneJump.ts` for why it doesn't need a
// `SyncSession` to exist.
initPaneJump()

// --- documents <-> editor -------------------------------------------------
//
// The documents feature never imports the editor (or vice versa); this is
// the one place that knows both. It also supplies the first-run welcome text
// from the editor's public API, so `documents` stays free of any editor seed
// content.
initDocuments({ welcomeContent: WELCOME_CONTENT })

// Puts the active document's id in the URL and keeps it there — see
// `src/app/urlSync.ts` for the routing-approach writeup (query param +
// History API, no router) and the URL-vs-persisted-`activeId` precedence
// rule. Depends only on `documents`' public API, but lives here rather than
// inside that feature: `documents` has no notion of the browser's URL/
// History any more than it has a notion of `layout` or `editor`, and every
// other "feature's state meets something outside its own concern" link in
// this file already lives here for the same reason.
initUrlSync()

// A genuine user edit updates the active document. The active id is read
// here and travels with the payload, so the autosave/flush logic downstream
// never has to read `$activeId` at a moment a switch might be changing it.
sample({
  clock: contentChanged,
  source: $activeId,
  filter: (id: string | null): boolean => id !== null,
  // `filter` guarantees `id` is non-null here; the assertion just satisfies
  // the compiler (effector doesn't narrow the source through `filter` into
  // `fn`).
  fn: (id, content) => ({ id: id as string, content }),
  target: activeDocumentEdited,
})

// When a different document becomes active (restore, switch, create,
// duplicate, or the auto-created doc after deleting the last one), load its
// content into the editor — a full CodeMirror state rebuild that discards
// undo history and resets cursor/scroll, and does not mark it dirty.
sample({
  clock: activeDocumentLoaded,
  target: loadContent,
})

// --- documents <-> layout ----------------------------------------------------
//
// On the docked desktop sidebar, picking/creating/duplicating/importing a
// document must NOT auto-close the drawer — that would fight the user's own
// persisted open/closed choice (see `features/documents/ui/DocumentDrawer.vue`'s
// docked/overlay rework). On mobile the drawer is still a full-screen
// overlay, so the original "auto-close after picking a document" UX is kept.
// `documents` has no notion of `layout`'s desktop/mobile breakpoint, so this
// lives here rather than as a reducer inside `documents`' own model.
sample({
  clock: [documentSelected, documentCreated, documentDuplicated, documentImported],
  source: $isDesktop,
  filter: (isDesktop) => !isDesktop,
  target: drawerClosed,
})

// --- documents <-> transfer -------------------------------------------------
//
// `transfer` never imports `documents` (or vice versa); this is the one
// place that knows both, same shape as every other cross-feature link in
// this file.

// A successfully-imported file (drag-drop or the toolbar's file picker,
// see `features/transfer`) always becomes a brand-new document — never
// overwrites the active one, see `documentImported`'s doc comment.
sample({
  clock: markdownFileImported,
  target: documentImported,
})

// `transfer` needs the active document's title/content to name and build
// exports, projected down to just that shape (`ExportDocument`) so the
// feature never has to know about `MarkdownDocument`'s id/timestamps.
sample({
  source: $activeDocument,
  fn: (doc) => (doc === null ? null : { title: doc.title, content: doc.content }),
  target: exportSourceChanged,
})

// The one thing HTML/PDF export needs from `preview` — rendering markdown
// to sanitized HTML — is injected here rather than imported directly by
// `transfer`, the same way `initDocuments` above injects the editor's
// welcome text instead of `documents` importing `editor`. Also installs
// the window-level drag/drop guard for the app's lifetime — see
// `features/transfer/model/transfer.ts`'s `initTransfer`.
initTransfer({ renderMarkdown: renderMarkdownForExport })

// --- settings <-> editor / documents (Step 8) -------------------------------
//
// `settings` owns every persisted preference; it never imports the feature
// that actually acts on a given one (same shape as every other link in
// this file) — this is the one place that knows both sides.

// Line wrap is a real CodeMirror extension (a `Compartment` reconfigure,
// not a state rebuild — see `features/editor/lib/useCodeMirror.ts`), so the
// editor feature keeps its own live mirror of the persisted preference
// (`$lineWrapEnabled` in `model/editorEvents.ts`) rather than reading the
// settings store directly. One explicit kick applies the restored/default
// value before any component mounts; `sample`'s `clock` only reacts to
// later updates (same reasoning as the `sourceReceived` kick above).
lineWrapChanged($lineWrapPreference.getState())
sample({ clock: $lineWrapPreference, target: lineWrapChanged })

// Autosave interval: same one-kick-then-sample shape, feeding
// `documents`' own debounce store (`$autosaveIntervalMs` in
// `model/documents.ts`, passed to patronum's `debounce` as a reactive
// `Store<number>` so a settings change takes effect on the very next edit).
autosaveIntervalChanged($autosaveDebounceMs.getState())
sample({ clock: $autosaveDebounceMs, target: autosaveIntervalChanged })

// --- editor shortcuts that reach outside the editor feature -----------------

// Mod-S inside the editor bypasses the documents feature's autosave
// debounce and flushes whatever's pending immediately.
sample({ clock: saveNowRequested, target: saveRequested })

// Mod-Shift-V inside the editor cycles the toolbar's view-mode switcher —
// the editor doesn't know `layout` exists, so it only fires an intent
// event; the actual next mode is resolved here.
const VIEW_MODE_CYCLE: Record<ViewMode, ViewMode> = {
  editor: 'split',
  split: 'preview',
  preview: 'editor',
}
sample({
  clock: viewModeCycleRequested,
  source: $viewMode,
  fn: (mode) => VIEW_MODE_CYCLE[mode],
  target: viewModeChanged,
})

// Mod-/ inside the editor opens the keyboard-shortcuts help modal, owned by
// `features/settings`.
sample({ clock: helpRequested, target: helpOpened })

// --- documents <-> github ----------------------------------------------------
//
// `github` may import `@/features/documents`'s public API (one-directional,
// for the `GitHubOrigin` type); `documents` never imports `github`. As with
// every other pair in this file, this is the one place that knows both, and
// connects them.

// Re-validate any stored token on startup — same "plain function called once"
// shape as `initDocuments`/`initTransfer` above.
initGithub()

// Opening a file from GitHub always becomes a brand-new document, never
// overwrites the active one — same additive rule as an import.
sample({ clock: fileOpened, target: documentOpenedFromOrigin })

// A landed commit catches the document's recorded origin up to the new blob
// sha (metadata only — `documentGithubSynced` deliberately doesn't bump
// `updatedAt`).
sample({ clock: commitSucceeded, target: documentGithubSynced })

// The "reload remote, discard local edits" conflict choice replaces the
// document's content + origin with the fetched remote version.
sample({ clock: remoteReloadRequested, target: documentRemoteApplied })

// Project the active document down into `github`'s commit model — just
// `{ id, content, origin }`, and only when it actually has a GitHub origin
// (otherwise `null`). Same shape as the `exportSourceChanged` projection
// above.
sample({
  source: $activeDocument,
  fn: (doc) =>
    doc === null || doc.origin === null
      ? null
      : { id: doc.id, content: doc.content, origin: doc.origin },
  target: activeDocumentForCommitChanged,
})

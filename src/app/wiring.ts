// Cross-feature Effector wiring lives here (e.g. `sample`s that connect
// events/stores from one feature to another), and this is also where the
// composition root owns model initialisation: importing a feature's
// public API here (rather than relying on it being pulled in transitively
// by some UI component) guarantees the model starts up regardless of
// which components end up rendered.
import { combine, sample } from 'effector'

import {
  $content,
  contentChanged,
  loadContent,
  WELCOME_CONTENT,
  saveNowRequested,
  viewModeCycleRequested,
  helpRequested,
  lineWrapChanged,
  editorFontMetricsChanged,
  spellcheckSettingsChanged,
} from '@/features/editor'
import { sourceReceived, renderMarkdownForExport } from '@/features/preview'
import { initScrollSync, scrollSyncEnabledChanged } from '@/features/scroll-sync'
import {
  initDocuments,
  activeDocumentEdited,
  activeDocumentLoaded,
  documentImported,
  documentsBulkImported,
  documentGithubOriginsApplied,
  folderSyncDirPathsApplied,
  documentSelected,
  documentCreated,
  documentDuplicated,
  drawerClosed,
  saveRequested,
  autosaveIntervalChanged,
  $activeId,
  $activeDocument,
  $documentList,
  $folders,
} from '@/features/documents'
import { initTransfer, markdownFileImported, exportSourceChanged } from '@/features/transfer'
import {
  initGithub,
  initGithubOAuth,
  documentsSnapshotChanged,
  foldersSnapshotChanged,
  importCompleted,
  originsAssigned,
  folderDirsAssigned,
  pushCompleted,
  githubSettingsRequested,
  autoSyncIntervalChanged,
} from '@/features/github'
import { $viewMode, viewModeChanged, $isDesktop } from '@/features/layout'
import type { ViewMode } from '@/features/layout'
import {
  $lineWrapEnabled as $lineWrapPreference,
  $autosaveDebounceMs,
  $scrollSyncEnabled,
  $editorFontSize,
  $editorFontFamily,
  $spellCheckEnabled,
  $spellCheckLanguage,
  $autoSyncIntervalMinutes,
  helpOpened,
  settingsOpened,
} from '@/features/settings'

import { initUrlSync } from './urlSync'
import { initPaneJump } from './paneJump'
import { initDocumentsSearchShortcut } from './documentsSearchShortcut'

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

// Ctrl+Shift+F / Cmd+Shift+F — jumps to the `documents` feature's existing
// across-documents search, opening its drawer first if needed. See
// `documentsSearchShortcut.ts`'s own doc comment for why this is a plain
// `window` keydown listener rather than a CodeMirror `keymap` binding.
initDocumentsSearchShortcut()

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

// Editor font size/family: CodeMirror needs no Compartment reconfigure for
// either (both already repaint `.cm-scroller` purely via the CSS custom
// properties `editorPreferences.ts` applies to `<html>` — see
// `editorFontMetricsChanged`'s doc comment in `features/editor/model/
// editorEvents.ts`), only a nudge to re-measure the layout that repaint
// just changed. No startup kick needed here (unlike every other mirror in
// this section) — the view's very first measure at mount already reflects
// whichever CSS custom property value was already applied before it mounted.
//
// `clock: [$editorFontSize, $editorFontFamily]` (an array of units, not a
// `combine`) deliberately — a `combine(...)` whose `fn` always returns the
// same constant (there's no real payload `editorFontMetricsChanged` needs)
// is itself a derived *store*, and effector skips a store's own update
// when the freshly computed value is `Object.is`-equal to what it already
// held. Every recompute here would produce that same constant, so after
// the very first one the derived store would stop emitting entirely and
// `editorFontMetricsChanged` would silently never fire again — measured
// while verifying this change (CodeMirror's height map went stale, exactly
// the ~85%-off failure mode this event exists to prevent). An array clock
// has no such store/equality semantics: `sample` re-fires on every update
// of every listed unit, unconditionally.
sample({
  clock: [$editorFontSize, $editorFontFamily],
  target: editorFontMetricsChanged,
})

// Spell check enabled/language: bundled into one `combine`d store (unlike
// the array-clock trick `editorFontMetricsChanged` uses just above) because
// this mirror actually needs a real payload — `spellcheckSettingsChanged`
// carries the current `{ enabled, language }` pair, not just a "something
// changed" signal — so the array-clock's dedup hazard (documented on
// `editorFontMetricsChanged` above) doesn't apply here: a `combine`d store
// only skips a re-emit when the *computed value* is unchanged, which is
// exactly what should happen when neither input actually changed.
const $spellCheckSettings = combine(
  $spellCheckEnabled,
  $spellCheckLanguage,
  (enabled, language) => ({ enabled, language }),
)
spellcheckSettingsChanged($spellCheckSettings.getState())
sample({ clock: $spellCheckSettings, target: spellcheckSettingsChanged })

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
// connects them. Automatic one-way sync (every document, every folder) has
// replaced the old per-file "Save/Commit to GitHub" flow this section used
// to wire — see `features/github/model/sync.ts`'s doc comment for the full
// design.

// Handle a GitHub App authorize-redirect landing here BEFORE re-validating
// any stored token — see `features/github/model/oauth.ts`'s `initGithubOAuth`
// doc comment for why this is a no-op on every load except that one, and
// why it strips `code`/`state` from the URL immediately regardless of
// outcome. Ordering relative to `initGithub()` below doesn't affect
// correctness (a fresh callback has no stored token yet; a stale one just
// gets re-validated and then overwritten a moment later once the exchange
// resolves), but running it first keeps "handle the redirect" and "restore
// an existing session" in the order a reader would expect.
initGithubOAuth()

// Re-validate any stored token on startup — same "plain function called once"
// shape as `initDocuments`/`initTransfer` above. `github`'s own
// `$syncConnection` needs no equivalent kick (it seeds itself synchronously
// from storage).
initGithub()

// `github`'s sync engine needs a live projection of every document/folder —
// not just the active one, unlike the old commit/save flow — down to just
// what it needs to assign paths and detect changes. Fires on every
// `$documentList`/`$folders` update; `github`'s own debounce (well past the
// editor's autosave debounce) is what keeps this from pushing on every
// keystroke.
sample({
  source: $documentList,
  fn: (docs) =>
    docs.map((doc) => ({
      id: doc.id,
      title: doc.title,
      content: doc.content,
      folderId: doc.folderId,
      origin: doc.origin,
    })),
  target: documentsSnapshotChanged,
})
sample({
  source: $folders,
  fn: (folders) =>
    folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      syncDirPath: folder.syncDirPath,
    })),
  target: foldersSnapshotChanged,
})

// First-connect import: every remote markdown file not already linked to a
// local document becomes a brand-new one.
sample({ clock: importCompleted, target: documentsBulkImported })

// Path/directory assignment write-backs (metadata only, `updatedAt`
// untouched) and the hash refresh after a successful push both land on the
// same `documentGithubOriginsApplied` event — see its doc comment in
// `features/documents/model/documents.ts` for why one event covers both.
sample({ clock: originsAssigned, target: documentGithubOriginsApplied })
sample({ clock: pushCompleted, target: documentGithubOriginsApplied })
sample({ clock: folderDirsAssigned, target: folderSyncDirPathsApplied })

// The GitHub connection UI now lives inside the Settings dialog's own
// "Sync" category (`features/github/ui/GitHubSyncPanel.vue`, moved there
// from the removed standalone `GitHubModal.vue`, alongside the local
// autosave interval) rather than a dedicated modal `github` owns. `github`
// still has no notion `settings` exists — clicking the sync status pill
// (`SyncStatusIndicator.vue`) only fires a plain intent event, resolved
// into `settings`' own `settingsOpened('sync')` here, the same
// fire-an-intent/let-wiring-resolve-it shape as `helpRequested` ->
// `helpOpened` below.
sample({
  clock: githubSettingsRequested,
  fn: () => 'sync' as const,
  target: settingsOpened,
})

// --- settings <-> github -----------------------------------------------------
//
// Auto-sync interval: same one-kick-then-sample shape as the autosave
// interval above, feeding `github`'s own live mirror (`$autoSyncIntervalMs`
// in `model/sync.ts`, consumed by its `decideSyncSchedule`). Persisted in
// minutes — the unit the Settings UI's `<select>` picks from — and converted
// to ms here, at the one place that knows both `settings`' unit and what
// `github` actually wants.
autoSyncIntervalChanged($autoSyncIntervalMinutes.getState() * 60_000)
sample({
  clock: $autoSyncIntervalMinutes,
  fn: (minutes) => minutes * 60_000,
  target: autoSyncIntervalChanged,
})

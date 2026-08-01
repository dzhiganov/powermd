// Cross-feature Effector wiring lives here (e.g. `sample`s that connect
// events/stores from one feature to another), and this is also where the
// composition root owns model initialisation: importing a feature's
// public API here (rather than relying on it being pulled in transitively
// by some UI component) guarantees the model starts up regardless of
// which components end up rendered.
import { sample } from 'effector'

import { $content, contentChanged, loadContent, WELCOME_CONTENT } from '@/features/editor'
import { sourceReceived, renderMarkdownForExport } from '@/features/preview'
import { initScrollSync } from '@/features/scroll-sync'
import {
  initDocuments,
  activeDocumentEdited,
  activeDocumentLoaded,
  documentImported,
  $activeId,
  $activeDocument,
} from '@/features/documents'
import { initTransfer, markdownFileImported, exportSourceChanged } from '@/features/transfer'

import '@/features/settings'
import '@/features/editor'
import '@/features/preview'
import '@/features/documents'
import '@/features/transfer'

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

// --- documents <-> editor -------------------------------------------------
//
// The documents feature never imports the editor (or vice versa); this is
// the one place that knows both. It also supplies the first-run welcome text
// from the editor's public API, so `documents` stays free of any editor seed
// content.
initDocuments({ welcomeContent: WELCOME_CONTENT })

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

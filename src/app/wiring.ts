// Cross-feature Effector wiring lives here (e.g. `sample`s that connect
// events/stores from one feature to another), and this is also where the
// composition root owns model initialisation: importing a feature's
// public API here (rather than relying on it being pulled in transitively
// by some UI component) guarantees the model starts up regardless of
// which components end up rendered.
import { sample } from 'effector'

import { $content, contentChanged, loadContent, WELCOME_CONTENT } from '@/features/editor'
import { sourceReceived } from '@/features/preview'
import { initScrollSync } from '@/features/scroll-sync'
import {
  initDocuments,
  activeDocumentEdited,
  activeDocumentLoaded,
  $activeId,
} from '@/features/documents'

import '@/features/settings'
import '@/features/editor'
import '@/features/preview'
import '@/features/documents'

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

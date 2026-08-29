import { sample } from 'effector'

import {
  $activeId,
  $activeDocument,
  loadHighlightsForDocument,
  saveHighlights,
  removeHighlights,
} from '@/features/documents'
import {
  $editorSelection,
  editorHighlightsChanged,
  editorHighlightsRemapped,
  editorHighlightClicked,
} from '@/features/editor'
import {
  initHighlights,
  activeDocumentChanged,
  selectionChanged,
  highlightClicked,
  rangesRemapped,
  documentTextChanged,
  $highlights,
} from '@/features/highlights'

/**
 * Connects the `highlights` feature to `editor` (which paints the ranges and
 * reports selections) and `documents` (which owns the database).
 *
 * Neither of those two knows `highlights` exists, and `highlights` imports
 * neither — same shape as `paneJump.ts`, `wikiLinks.ts` and
 * `taskListToggle.ts`, and for the same reason: a feature that reached into
 * two others directly would make all three impossible to move or remove
 * independently.
 */
export function initHighlightsWiring(): void {
  // Storage, injected rather than imported — `documents` owns `lib/db.ts`
  // and this feature must not reach into it. Same DI shape as
  // `initTransfer`'s `renderMarkdown`.
  initHighlights({
    load: loadHighlightsForDocument,
    save: saveHighlights,
    remove: removeHighlights,
  })

  // Which document's highlights to show. One kick for the value the store
  // already holds (a restore can resolve before this module evaluates),
  // then every later change — the same shape as every other mirror in
  // `wiring.ts`.
  activeDocumentChanged($activeId.getState())
  sample({ source: $activeId, target: activeDocumentChanged })

  // The document's text, so a remapped highlight can refresh the cached
  // quote it shows in the panel.
  documentTextChanged($activeDocument.getState()?.content ?? '')
  sample({
    source: $activeDocument,
    fn: (doc) => doc?.content ?? '',
    target: documentTextChanged,
  })

  // Editor -> highlights: what is selected, what was clicked, what an edit
  // did to the ranges.
  sample({ source: $editorSelection, target: selectionChanged })
  sample({ clock: editorHighlightClicked, target: highlightClicked })
  sample({ clock: editorHighlightsRemapped, target: rangesRemapped })

  // Highlights -> editor: paint the current set. Projected down to what the
  // editor actually needs, so it never sees a note or a document id.
  sample({
    source: $highlights,
    fn: (highlights) =>
      highlights.map((highlight) => ({
        id: highlight.id,
        from: highlight.from,
        to: highlight.to,
        color: highlight.color,
      })),
    target: editorHighlightsChanged,
  })
}

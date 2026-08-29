import { createEvent, createStore } from 'effector'

import type { EditorHighlight, EditorSelectionInfo } from '../lib/highlightDecorations'
import { setHighlightsEffect } from '../lib/highlightDecorations'
import { remapRanges, type RemapResult } from '../lib/highlightRanges'
import { $editorView } from './view'

export type { EditorSelectionInfo }

/**
 * The editor's half of the highlights feature.
 *
 * `features/highlights` owns the authoritative list and persists it; this
 * module owns only what needs a live `EditorView`: painting the ranges,
 * re-anchoring them across edits, and reporting what is selected. Neither
 * feature imports the other — `src/app/highlights.ts` connects them, the
 * same shape as every other cross-feature link in this codebase.
 */

// --- Inputs (driven by `features/highlights` via wiring) --------------------

/** Replace the painted set. */
export const editorHighlightsChanged = createEvent<readonly EditorHighlight[]>()

// --- Outputs (consumed by `features/highlights` via wiring) -----------------

/** Fires on every selection change; `null` when nothing is selected. */
export const editorSelectionChanged = createEvent<EditorSelectionInfo | null>()
export const $editorSelection = createStore<EditorSelectionInfo | null>(null).on(
  editorSelectionChanged,
  (_, selection) => selection,
)

/** Fires after an edit moved or destroyed highlight ranges. The payload is
 * the DIFFERENCE, not the whole set — see `remapRanges`. */
export const editorHighlightsRemapped = createEvent<RemapResult>()

/** Fires when the user clicks inside a painted highlight, carrying its id —
 * this is what opens the edit popover. */
export const editorHighlightClicked = createEvent<string>()

// --- Painting ---------------------------------------------------------------

// A plain `.watch` reading the view from the store, rather than a `sample`
// with a type-guard filter: effector does not narrow a `filter` through into
// a downstream `.watch`, so that shape needs a non-null assertion to compile
// — and an assertion is exactly the wrong thing here, since "no view yet" is
// a real state (highlights can load before the editor mounts).
editorHighlightsChanged.watch((highlights) => {
  $editorView.getState()?.dispatch({ effects: setHighlightsEffect.of(highlights) })
})

// --- Re-anchoring -----------------------------------------------------------

/** The ranges currently painted, kept here so an edit can be re-anchored
 * without asking `features/highlights` for the list first (which would be a
 * round trip through the wiring layer on every keystroke). Updated from both
 * directions — a fresh set from outside, and the results of a remap. */
let anchored: { id: string; from: number; to: number }[] = []

editorHighlightsChanged.watch((highlights) => {
  anchored = highlights.map((highlight) => ({
    id: highlight.id,
    from: highlight.from,
    to: highlight.to,
  }))
})

/** Called from the editor's update listener (`lib/useCodeMirror.ts`) for
 * every document change. Kept as a plain function rather than an event so
 * the mapping is synchronous with the transaction that caused it. */
export function remapAnchoredHighlights(changes: Parameters<typeof remapRanges>[1]): void {
  if (anchored.length === 0) return
  const result = remapRanges(anchored, changes)
  if (result.moved.length === 0 && result.removed.length === 0) return

  const removed = new Set(result.removed)
  const movedById = new Map(result.moved.map((range) => [range.id, range]))
  anchored = anchored
    .filter((range) => !removed.has(range.id))
    .map((range) => movedById.get(range.id) ?? range)

  editorHighlightsRemapped(result)
}

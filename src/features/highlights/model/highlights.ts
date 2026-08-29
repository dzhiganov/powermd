import { createEvent, createStore, createEffect, sample } from 'effector'

import { DEFAULT_HIGHLIGHT_COLOR, type HighlightColorId } from '@/shared/config/highlightColors'
import { toastRequested } from '@/shared/lib/toast'

/** A highlight as this feature holds it. Structurally identical to
 * `documents`' `Highlight`, redeclared here so the feature owns its own
 * shape rather than importing a sibling's — the storage functions come in
 * through `initHighlights` for the same reason. */
export interface Highlight {
  id: string
  documentId: string
  from: number
  to: number
  color: HighlightColorId
  note: string
  text: string
  createdAt: number
}

/** Where a selection is, mirrored from `editor` via `app/highlights.ts`. */
export interface SelectionInfo {
  from: number
  to: number
  text: string
  rect: { left: number; right: number; top: number; bottom: number } | null
}

// --- Dependency injection ---------------------------------------------------
//
// `documents` owns the database; this feature must not reach into it. The
// four functions it needs are injected once at startup, the same shape
// `initTransfer` already uses for the markdown renderer it cannot import.

export interface HighlightsDeps {
  load: (documentId: string) => Promise<Highlight[]>
  save: (highlights: readonly Highlight[]) => Promise<void>
  remove: (ids: readonly string[]) => Promise<void>
}

let deps: HighlightsDeps | null = null

export function initHighlights(options: HighlightsDeps): void {
  deps = options
}

function requireDeps(): HighlightsDeps {
  if (deps === null) throw new Error('[highlights] initHighlights was not called')
  return deps
}

// --- Inputs (from `app/highlights.ts`) --------------------------------------

/** The open document changed — highlights are per document. */
export const activeDocumentChanged = createEvent<string | null>()
/** Mirrors the editor's current selection. */
export const selectionChanged = createEvent<SelectionInfo | null>()
/** The user clicked a painted highlight in the editor. */
export const highlightClicked = createEvent<string>()
/** An edit moved or destroyed ranges — see `editor`'s `remapRanges`. */
export const rangesRemapped = createEvent<{
  moved: { id: string; from: number; to: number }[]
  removed: string[]
}>()
/** The document's current text, so a remapped highlight can refresh the
 * cached `text` it shows in the panel. */
export const documentTextChanged = createEvent<string>()

// --- Commands (from the UI) -------------------------------------------------

/** Create a highlight over the current selection. Carries a note because
 * the selection toolbar can create one WITH a note in a single step (type
 * into the note field, press Cmd/Ctrl+Enter) — see `HighlightToolbar.vue`. */
export const highlightCreated = createEvent<{ color: HighlightColorId; note: string }>()
export const highlightColorSet = createEvent<{ id: string; color: HighlightColorId }>()
export const highlightNoteSet = createEvent<{ id: string; note: string }>()
export const highlightRemoved = createEvent<string>()
/** Opens/closes the edit popover for a highlight. `null` closes it. */
export const highlightOpened = createEvent<string | null>()
export const panelToggled = createEvent()
export const selectionDismissed = createEvent()

/** The built highlight, fanned out to the store and to disk from ONE place.
 * Building it inside the `$highlights` reducer instead would leave the save
 * effect having to work out which entry was new by comparing lists.
 *
 * Declared up here with the other events, not next to the `sample` that
 * fires it, because `$selection` below has to reset on THIS rather than on
 * `highlightCreated` — see that store's comment. */
const highlightBuilt = createEvent<Highlight>()

// --- State ------------------------------------------------------------------

const $documentId = createStore<string | null>(null).on(activeDocumentChanged, (_, id) => id)
const $documentText = createStore('').on(documentTextChanged, (_, text) => text)

/**
 * Resets on `highlightBuilt`, NOT on `highlightCreated`.
 *
 * `highlightCreated` is the command, and the `sample` that turns it into a
 * highlight reads THIS STORE as its source. Effector applies a store's own
 * `.on`/`.reset` reducers for an event before the samples that read that
 * store as source run for the same event — so resetting here on
 * `highlightCreated` cleared the selection out from under that sample, its
 * filter saw `null`, and clicking a colour silently did nothing at all. No
 * error, no console warning: the toolbar simply appeared, accepted the
 * click, and produced no highlight.
 *
 * `highlightBuilt` fires downstream of that sample, once the selection has
 * already been read, so the reset lands after the work rather than before
 * it — and it still clears the toolbar the moment a highlight is made.
 */
export const $selection = createStore<SelectionInfo | null>(null)
  .on(selectionChanged, (_, selection) => selection)
  .reset(selectionDismissed, highlightBuilt, activeDocumentChanged)

/** Sorted by position, which is the order the panel lists them in — reading
 * order is the only order that lets you find a highlight by remembering
 * where in the document it was. */
export const $highlights = createStore<Highlight[]>([])

export const $highlightCount = $highlights.map((highlights) => highlights.length)

/** Which highlight the edit popover is open for. */
export const $openHighlightId = createStore<string | null>(null)
  .on(highlightOpened, (_, id) => id)
  .on(highlightClicked, (_, id) => id)
  .on(highlightRemoved, (current, id) => (current === id ? null : current))
  .reset(activeDocumentChanged)

export const $openHighlight = sample({
  source: { highlights: $highlights, id: $openHighlightId },
  fn: ({ highlights, id }) =>
    id === null ? null : (highlights.find((highlight) => highlight.id === id) ?? null),
})

const PANEL_STORAGE_KEY = 'markdown-editor:highlights-panel'

function readPanelOpen(): boolean {
  try {
    return localStorage.getItem(PANEL_STORAGE_KEY) === 'true'
  } catch {
    // Private browsing with storage disabled — default to closed rather
    // than letting a storage error break the app shell.
    return false
  }
}

export const $panelOpen = createStore(readPanelOpen()).on(panelToggled, (open) => !open)

$panelOpen.watch((open) => {
  try {
    localStorage.setItem(PANEL_STORAGE_KEY, String(open))
  } catch {
    // Nothing to do — the preference just won't survive a reload.
  }
})

// --- Loading ----------------------------------------------------------------

const loadFx = createEffect((documentId: string): Promise<Highlight[]> =>
  requireDeps().load(documentId),
)

sample({
  clock: activeDocumentChanged,
  filter: (id): id is string => id !== null,
  target: loadFx,
})

// A document with no id (none open yet) has no highlights to show.
sample({
  clock: activeDocumentChanged,
  filter: (id) => id === null,
  fn: () => [],
  target: $highlights,
})

sample({
  clock: loadFx.doneData,
  fn: sortByPosition,
  target: $highlights,
})

sample({
  clock: loadFx.fail,
  fn: (): { text: string; tone: 'error' } => ({
    text: 'Could not load highlights for this document.',
    tone: 'error',
  }),
  target: toastRequested,
})

function sortByPosition(highlights: readonly Highlight[]): Highlight[] {
  return [...highlights].sort((a, b) => a.from - b.from || a.to - b.to)
}

// --- Creating ---------------------------------------------------------------

const saveFx = createEffect((highlights: readonly Highlight[]): Promise<void> =>
  requireDeps().save(highlights),
)
const removeFx = createEffect((ids: readonly string[]): Promise<void> => requireDeps().remove(ids))

sample({
  clock: highlightCreated,
  source: { selection: $selection, documentId: $documentId },
  filter: ({ selection, documentId }) =>
    selection !== null && documentId !== null && selection.text.trim() !== '',
  fn: ({ selection, documentId }, { color, note }): Highlight => ({
    id: crypto.randomUUID(),
    documentId: documentId as string,
    from: (selection as SelectionInfo).from,
    to: (selection as SelectionInfo).to,
    color,
    note,
    text: (selection as SelectionInfo).text,
    createdAt: Date.now(),
  }),
  target: highlightBuilt,
})

$highlights.on(highlightBuilt, (highlights, created) => sortByPosition([...highlights, created]))

sample({ clock: highlightBuilt, fn: (created) => [created], target: saveFx })

// --- Editing ----------------------------------------------------------------

$highlights
  .on(highlightColorSet, (highlights, { id, color }) =>
    highlights.map((highlight) => (highlight.id === id ? { ...highlight, color } : highlight)),
  )
  .on(highlightNoteSet, (highlights, { id, note }) =>
    highlights.map((highlight) => (highlight.id === id ? { ...highlight, note } : highlight)),
  )
  .on(highlightRemoved, (highlights, id) => highlights.filter((highlight) => highlight.id !== id))
  // An edit moved ranges: apply the new offsets and refresh the cached text
  // so the panel shows what the highlight now covers, not what it used to.
  .on(rangesRemapped, (highlights, { moved, removed }) => {
    if (moved.length === 0 && removed.length === 0) return highlights
    const removedIds = new Set(removed)
    const movedById = new Map(moved.map((range) => [range.id, range]))
    return highlights
      .filter((highlight) => !removedIds.has(highlight.id))
      .map((highlight) => {
        const range = movedById.get(highlight.id)
        return range === undefined ? highlight : { ...highlight, from: range.from, to: range.to }
      })
  })

// Refresh the cached display text for whatever the ranges now cover.
sample({
  clock: rangesRemapped,
  source: { highlights: $highlights, text: $documentText },
  fn: ({ highlights, text }) =>
    highlights.map((highlight) => {
      const current = text.slice(highlight.from, highlight.to)
      return current === highlight.text ? highlight : { ...highlight, text: current }
    }),
  target: $highlights,
})

// --- Persistence ------------------------------------------------------------

sample({
  clock: [highlightColorSet, highlightNoteSet],
  source: $highlights,
  fn: (highlights, payload) => highlights.filter((highlight) => highlight.id === payload.id),
  target: saveFx,
})

sample({ clock: highlightRemoved, fn: (id) => [id], target: removeFx })

sample({
  clock: rangesRemapped,
  source: $highlights,
  fn: (highlights, { moved }) => {
    const movedIds = new Set(moved.map((range) => range.id))
    return highlights.filter((highlight) => movedIds.has(highlight.id))
  },
  filter: (_, { moved }) => moved.length > 0,
  target: saveFx,
})

sample({
  clock: rangesRemapped,
  filter: ({ removed }) => removed.length > 0,
  fn: ({ removed }) => removed,
  target: removeFx,
})

sample({
  clock: [saveFx.fail, removeFx.fail],
  fn: (): { text: string; tone: 'error' } => ({
    text: 'Could not save your highlights.',
    tone: 'error',
  }),
  target: toastRequested,
})

export { DEFAULT_HIGHLIGHT_COLOR }

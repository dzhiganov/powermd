import { combine, createEffect, createEvent, createStore, sample } from 'effector'
import { debounce } from 'patronum'

import * as db from '../lib/db'
import { createId } from '../lib/id'
import { deriveTitle } from '../lib/title'
import type { MarkdownDocument, SaveStatus } from './types'

/** Autosave debounce: writes land ~500ms after typing pauses, never on
 * every keystroke. A document switch flushes any still-pending write first
 * (see the flush `sample` below). The debounced tick itself can't be
 * cancelled (patronum's `debounce` exposes no external cancel), so a delete
 * that fires mid-debounce is handled by dropping the tick instead — see the
 * `autosaveTick` sample below. A `pagehide`/`visibilitychange`/localStorage
 * mirror (further down) covers the reload-before-the-debounce-fires case. */
const AUTOSAVE_MS = 500

/** localStorage key for the synchronous mirror of `$pendingSave`. IndexedDB
 * writes are not guaranteed to complete during unload, but localStorage is
 * synchronous — so it is the safety net for "edited, then reloaded/closed
 * before the debounce (or the unload flush) landed". */
const PENDING_SAVE_KEY = 'markdown-editor:pendingSave'

// --- Public intents (fired from UI / wiring) -----------------------------

/** Create a new empty document and make it active. */
export const documentCreated = createEvent()
/** Make the document with this id active (a drawer click). */
export const documentSelected = createEvent<string>()
/** Rename a document. */
export const documentRenamed = createEvent<{ id: string; title: string }>()
/** Duplicate a document and make the copy active. */
export const documentDuplicated = createEvent<string>()
/** Ask to delete a document — opens the confirmation step, deletes nothing
 * yet (deletion is irreversible, so it always requires confirmation). */
export const documentDeleteRequested = createEvent<string>()
/** Confirm the pending deletion. */
export const documentDeleteConfirmed = createEvent()
/** Cancel the pending deletion. */
export const documentDeleteCancelled = createEvent()

export const drawerToggled = createEvent()
export const drawerClosed = createEvent()

/**
 * A genuine user edit to the active document, id captured at edit time.
 * Fired from `src/app/wiring.ts` off the editor's `contentChanged`. The id
 * travels with the payload so nothing downstream has to read `$activeId`
 * (whose value at flush time could otherwise race a document switch).
 */
export const activeDocumentEdited = createEvent<{ id: string; content: string }>()

/**
 * Fired when a different document's content must be loaded into the editor
 * (restore on startup, switch, create, duplicate, or the auto-created
 * document after deleting the last one). Consumed in `wiring.ts` -> editor
 * `loadContent`, which rebuilds the CodeMirror state.
 */
export const activeDocumentLoaded = createEvent<string>()

// --- Internal events -----------------------------------------------------

// A content edit to the active document, as a full snapshot. Updates the
// list + arms the debounced autosave via `$pendingSave`. Carried as its own
// event (rather than reading a store the same trigger mutates) so ordering
// never races.
const documentTouched = createEvent<MarkdownDocument>()
// A rename applied as a full snapshot. Updates the list and persists
// *immediately* and independently — renaming any document (even a
// non-active one) must never touch the active document's `$pendingSave`
// marker, or the active document's unsaved content edit could be dropped.
const documentRenameApplied = createEvent<MarkdownDocument>()
// A brand-new document to prepend + make active + persist.
const documentAdded = createEvent<MarkdownDocument>()
// A selection resolved against pre-switch state: the target id, whether it
// actually changed the active document, and the content to load.
const documentSwitchResolved = createEvent<{ id: string; changed: boolean; content: string }>()

interface AfterDelete {
  documents: MarkdownDocument[]
  activeId: string
  deletedId: string
  /** Non-null when the active document changed and its content must be
   * loaded into the editor. */
  loadContent: string | null
  /** Non-null when the last document was deleted and a fresh one was
   * auto-created, which must also be persisted. */
  createdDoc: MarkdownDocument | null
}
const documentDeleteApplied = createEvent<AfterDelete>()

// --- Helpers -------------------------------------------------------------

function makeWelcome(content: string): MarkdownDocument {
  const now = Date.now()
  return {
    id: createId(),
    title: deriveTitle(content) || 'Welcome',
    content,
    createdAt: now,
    updatedAt: now,
  }
}

function makeEmpty(): MarkdownDocument {
  const now = Date.now()
  return { id: createId(), title: 'Untitled', content: '', createdAt: now, updatedAt: now }
}

function mostRecent(docs: MarkdownDocument[]): MarkdownDocument {
  return docs.reduce((latest, doc) => (doc.updatedAt > latest.updatedAt ? doc : latest))
}

/** Reads the localStorage mirror of `$pendingSave`, if any. Defensive about
 * a missing/unavailable `localStorage` and about malformed JSON — this is a
 * best-effort recovery path, never a hard dependency. */
function readPendingMirror(): MarkdownDocument | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(PENDING_SAVE_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as MarkdownDocument).id !== 'string' ||
      typeof (parsed as MarkdownDocument).content !== 'string' ||
      typeof (parsed as MarkdownDocument).updatedAt !== 'number'
    ) {
      return null
    }
    return parsed as MarkdownDocument
  } catch {
    return null
  }
}

/** Synchronously mirrors (or clears) `$pendingSave` into localStorage. Kept
 * separate from the IndexedDB write, which is async and not guaranteed to
 * finish before an unload. */
function writePendingMirror(doc: MarkdownDocument | null): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (doc === null) {
      localStorage.removeItem(PENDING_SAVE_KEY)
    } else {
      localStorage.setItem(PENDING_SAVE_KEY, JSON.stringify(doc))
    }
  } catch {
    // Best-effort mirror only (storage may be full/unavailable) — the normal
    // IndexedDB autosave path is still in effect regardless.
  }
}

// --- Stores --------------------------------------------------------------

export const $documents = createStore<MarkdownDocument[]>([])
export const $activeId = createStore<string | null>(null)
/** Id awaiting delete confirmation, or null when no confirm is open. */
export const $pendingDelete = createStore<string | null>(null)
export const $drawerOpen = createStore(false)

/**
 * The pending (not-yet-persisted) document snapshot, id captured at edit
 * time. This — not `$activeId` — is what a switch flushes, which is why a
 * switch can never write the outgoing document's content into the incoming
 * document's record. Cleared when its matching write completes, and reset on
 * any document load (the outgoing pending write was already flushed, or, for
 * a deleted active document, is intentionally discarded).
 */
const $pendingSave = createStore<MarkdownDocument | null>(null)

/**
 * Per-document `updatedAt` last *confirmed* on disk by this tab — from this
 * tab's own initial load or its own successful write. Deliberately never
 * advanced by another tab's broadcast (see `documentBroadcastReceived`
 * below): that's what makes it usable as an optimistic-concurrency "base" —
 * every write passes its document's entry here to `db.putDocument`, which
 * refuses the write if disk has moved past it (another tab persisted a
 * version this tab never saw). If broadcasts kept it in sync, a write built
 * from this tab's still-stale editor content could sail through simply
 * because the *id* was known to be updated, silently erasing the other
 * tab's content anyway.
 */
const $knownDiskUpdatedAt = createStore<Record<string, number>>({})

/** Whether persistence is currently failing (a rejected write, or IndexedDB
 * being unavailable at startup). Drives the visible error state. */
const $persistError = createStore(false)

// --- Derived stores (public) --------------------------------------------

export const $activeDocument = combine($documents, $activeId, (docs, id) =>
  id === null ? null : (docs.find((doc) => doc.id === id) ?? null),
)

/** Documents most-recently-updated first, for the drawer list. */
export const $documentList = $documents.map((docs) =>
  [...docs].sort((a, b) => b.updatedAt - a.updatedAt),
)

export const $pendingDeleteDoc = combine($documents, $pendingDelete, (docs, id) =>
  id === null ? null : (docs.find((doc) => doc.id === id) ?? null),
)

/**
 * Derived so it can never disagree with reality: a non-null pending save
 * means "not on disk yet"; a persistence error overrides everything.
 */
export const $saveStatus = combine($pendingSave, $persistError, (pending, hasError): SaveStatus =>
  hasError ? 'error' : pending ? 'unsaved' : 'saved',
)

// --- Effects -------------------------------------------------------------

interface SavePayload {
  doc: MarkdownDocument
  /** The on-disk `updatedAt` this write was made against — see
   * `$knownDiskUpdatedAt`. */
  base: number
}
const saveDocumentFx = createEffect(({ doc, base }: SavePayload) => db.putDocument(doc, base))
const deleteDocumentFx = createEffect((id: string) => db.deleteDocument(id))
const persistActiveIdFx = createEffect((id: string) => db.setActiveId(id))

interface InitOptions {
  /** First-run welcome text — supplied by `wiring.ts` from the editor's
   * public API so this feature stays decoupled from the editor. */
  welcomeContent: string
}

const loadFx = createEffect(
  async ({
    welcomeContent,
  }: InitOptions): Promise<{
    documents: MarkdownDocument[]
    activeId: string
    persistent: boolean
  }> => {
    try {
      const [docs, storedActiveId] = await Promise.all([db.getAllDocuments(), db.getActiveId()])

      // Recover a localStorage-mirrored edit that never made it to
      // IndexedDB (reload/close in the same tick as the edit, or before the
      // unload flush completed). Never clobbers a genuinely newer record —
      // e.g. one another tab already persisted.
      const recovered = readPendingMirror()
      let documents = docs
      if (recovered !== null) {
        const existing = docs.find((doc) => doc.id === recovered.id)
        if (existing === undefined || recovered.updatedAt > existing.updatedAt) {
          documents =
            existing === undefined
              ? [recovered, ...docs]
              : docs.map((doc) => (doc.id === recovered.id ? recovered : doc))
          // Best-effort persist of the recovery — fire-and-forget so a slow
          // or failing write never blocks startup; the normal error/retry
          // path takes over if it fails. `base` is the disk value already
          // checked above, so this is a belt-and-suspenders repeat of the
          // same staleness guard inside `putDocument` itself.
          void db.putDocument(recovered, existing?.updatedAt ?? 0).catch((error: unknown) => {
            console.error('[documents] failed to persist recovered document', error)
          })
        }
      }
      writePendingMirror(null)

      if (documents.length > 0) {
        const activeId =
          storedActiveId !== null && documents.some((doc) => doc.id === storedActiveId)
            ? storedActiveId
            : mostRecent(documents).id
        return { documents, activeId, persistent: true }
      }
      // First run: seed and persist the welcome document.
      const welcome = makeWelcome(welcomeContent)
      await db.putDocument(welcome, welcome.updatedAt)
      await db.setActiveId(welcome.id)
      return { documents: [welcome], activeId: welcome.id, persistent: true }
    } catch (error) {
      // IndexedDB unavailable/blocked: keep working in-memory rather than
      // crashing, and surface the degraded (non-persistent) state.
      console.error('[documents] IndexedDB unavailable — running in-memory only', error)
      const welcome = makeWelcome(welcomeContent)
      return { documents: [welcome], activeId: welcome.id, persistent: false }
    }
  },
)

// --- Persistence error tracking ------------------------------------------

$persistError
  .on([saveDocumentFx.fail, deleteDocumentFx.fail, persistActiveIdFx.fail], () => true)
  .on([saveDocumentFx.done, deleteDocumentFx.done, persistActiveIdFx.done], () => false)
  .on(loadFx.doneData, (_, { persistent }) => !persistent)

// This tab's own confirmed-on-disk knowledge: seeded from the initial read,
// then advanced only by this tab's own writes (see `$knownDiskUpdatedAt`'s
// doc comment for why broadcasts must not feed it too).
$knownDiskUpdatedAt
  .on(loadFx.doneData, (_, { documents }) =>
    Object.fromEntries(documents.map((doc) => [doc.id, doc.updatedAt])),
  )
  .on(saveDocumentFx.done, (known, { result }) => ({ ...known, [result.id]: result.diskUpdatedAt }))
  .on(deleteDocumentFx.done, (known, { params: id }) => {
    if (!(id in known)) return known
    const rest = { ...known }
    delete rest[id]
    return rest
  })

// --- Initial load / seed -------------------------------------------------

$documents.on(loadFx.doneData, (_, { documents }) => documents)
$activeId.on(loadFx.doneData, (_, { activeId }) => activeId)

// Push the restored/seeded active document into the editor once it's known.
sample({
  clock: loadFx.doneData,
  fn: ({ documents, activeId }) => documents.find((doc) => doc.id === activeId)?.content ?? '',
  target: activeDocumentLoaded,
})

// --- Editing + autosave --------------------------------------------------

// Turn a raw edit into a full document snapshot. Reads `$documents` as it
// was *before* this edit (to keep the existing title/createdAt); the store
// is updated downstream via `documentReplaced`, so this read never races.
sample({
  clock: activeDocumentEdited,
  source: $documents,
  filter: (docs, { id }) => docs.some((doc) => doc.id === id),
  fn: (docs, { id, content }): MarkdownDocument => {
    const existing = docs.find((doc) => doc.id === id)
    const now = Date.now()
    return {
      id,
      title: existing?.title ?? 'Untitled',
      content,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
  },
  target: documentTouched,
})

// Apply the edit to the in-memory list immediately — so switching away
// always sees the latest content — and mark it pending so a save is owed.
$documents.on(documentTouched, (docs, touched) =>
  docs.map((doc) => (doc.id === touched.id ? touched : doc)),
)
$pendingSave.on(documentTouched, (_, touched) => touched)

// Debounced autosave. The tick carries the last touched snapshot, but the
// write reads the *freshest* version of that document from `$documents` at
// fire time — so a rename applied between the edit and the tick can't be
// clobbered by writing back a stale snapshot. The id still comes from the
// captured edit, so the write always targets the correct document.
//
// A delete can land *after* the debounce is armed but *before* it fires
// (patronum's `debounce` has no external cancel, so the timer keeps
// running). Without the `filter`, the fallback `?? touched` would resurrect
// the just-deleted document by re-`put`-ing the stale in-flight snapshot —
// the tick is dropped instead, which is the practical equivalent of having
// cancelled it.
const autosaveTick = debounce(documentTouched, AUTOSAVE_MS)
sample({
  clock: autosaveTick,
  source: { docs: $documents, known: $knownDiskUpdatedAt },
  filter: ({ docs }, touched) => docs.some((doc) => doc.id === touched.id),
  fn: ({ docs, known }, touched): SavePayload => ({
    doc: docs.find((doc) => doc.id === touched.id) as MarkdownDocument,
    base: known[touched.id] ?? 0,
  }),
  target: saveDocumentFx,
})

// Clear the pending marker once a write for that document completes with a
// disk state at least as new as the pending edit — meaning the pending
// content is now on disk (a later edit would have bumped `$pendingSave` to a
// newer timestamp, so this can't clear a genuinely-newer unsaved change).
// Uses `result.diskUpdatedAt` rather than `params.doc.updatedAt`: if the
// write was refused as stale (another tab's newer version won), the pending
// edit is genuinely still unsaved and must stay marked as such.
$pendingSave.on(saveDocumentFx.done, (pending, { params, result }) =>
  pending !== null && pending.id === params.doc.id && result.diskUpdatedAt >= pending.updatedAt
    ? null
    : pending,
)

// --- Retry a failed write --------------------------------------------------
//
// A rejected write (e.g. a transient QuotaExceededError) correctly flips
// `$saveStatus` to `error`, but without a retry the app only recovers on the
// next keystroke — so unsaved work sits indefinitely if the user stops
// typing right after the failure. Retries whatever is still pending, with
// capped exponential backoff so a persistently-failing write can't spin
// forever.
const RETRY_BASE_MS = 1000
const RETRY_MAX_ATTEMPTS = 5

// The attempt number about to be tried (1-based). Driven through its own
// event rather than incremented in a `.on(saveDocumentFx.fail, ...)`
// reducer read as a `sample` source off the same clock, which would leave
// read-order relative to the reducer unspecified — `retryRequested` makes
// the dependency explicit instead.
const retryRequested = createEvent<number>()
const $retryAttempt = createStore(0)
  .on(retryRequested, (_, attempt) => attempt)
  .reset(saveDocumentFx.done, activeDocumentLoaded)

const retryTimerFx = createEffect(
  (attempt: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, RETRY_BASE_MS * 2 ** (attempt - 1))
    }),
)

sample({
  clock: saveDocumentFx.fail,
  source: $retryAttempt,
  fn: (attempt) => attempt + 1,
  target: retryRequested,
})

sample({
  clock: retryRequested,
  filter: (attempt) => attempt <= RETRY_MAX_ATTEMPTS,
  target: retryTimerFx,
})

// Re-save whatever is *currently* pending (not necessarily the snapshot that
// originally failed — a newer edit may have superseded it, which is exactly
// what should be written).
sample({
  clock: retryTimerFx.done,
  source: { pending: $pendingSave, known: $knownDiskUpdatedAt },
  filter: ({ pending }): boolean => pending !== null,
  fn: ({ pending, known }): SavePayload => {
    const doc = pending as MarkdownDocument
    return { doc, base: known[doc.id] ?? 0 }
  },
  target: saveDocumentFx,
})

// --- Flush-on-switch (cross-contamination guard) -------------------------

// Any action that changes which document is active flushes the outgoing
// document's pending write *first*, using the pending snapshot's own id — so
// document A's content is written to A's record before B becomes active,
// never into B. Harmless if nothing is pending (filtered out) or if the
// still-armed debounce later re-writes the same snapshot.
//
// Same fallback hazard as the `autosaveTick` sample above: if the pending
// document no longer exists (deleted between the edit and this flush), the
// `?? owed` fallback would re-`put` the stale snapshot and resurrect it —
// filtered out instead.
sample({
  clock: [documentSelected, documentCreated, documentDuplicated],
  source: { pending: $pendingSave, docs: $documents, known: $knownDiskUpdatedAt },
  filter: ({ pending, docs }) =>
    pending !== null && docs.some((doc) => doc.id === (pending as MarkdownDocument).id),
  fn: ({ pending, docs, known }): SavePayload => {
    const owed = pending as MarkdownDocument
    return {
      doc: docs.find((doc) => doc.id === owed.id) as MarkdownDocument,
      base: known[owed.id] ?? 0,
    }
  },
  target: saveDocumentFx,
})

// After any load into the editor, the previous document's pending write has
// already been flushed (switch/create/duplicate) or intentionally dropped
// (deleted active document), so the marker is stale — reset it.
$pendingSave.reset(activeDocumentLoaded)

// --- Reload/close safety net ----------------------------------------------
//
// Mirror `$pendingSave` into localStorage synchronously on every change —
// including the moment an edit arms it — so a reload/close in the same tick
// as an edit (before the 500ms debounce, or even before a `pagehide` flush,
// can run) doesn't lose it. `localStorage` is synchronous, which is exactly
// why it works here despite being unsuitable as the primary store.
$pendingSave.watch(writePendingMirror)

function flushPendingToIndexedDB(): void {
  const pending = $pendingSave.getState()
  if (pending !== null) {
    saveDocumentFx({ doc: pending, base: $knownDiskUpdatedAt.getState()[pending.id] ?? 0 })
  }
}

if (typeof window !== 'undefined') {
  // Best-effort real flush attempts — not guaranteed to finish before
  // unload, which is why the localStorage mirror above is the actual safety
  // net, not this.
  window.addEventListener('pagehide', flushPendingToIndexedDB)
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) flushPendingToIndexedDB()
    })
  }
  // Warn the user before an unload that would otherwise silently discard
  // work still in flight.
  window.addEventListener('beforeunload', (event) => {
    if ($pendingSave.getState() !== null) {
      event.preventDefault()
      event.returnValue = ''
    }
  })
}

// --- Cross-tab sync ---------------------------------------------------------
//
// Two tabs on the same document store otherwise have no way to know about
// each other's writes/deletes. `db.putDocument`'s compare-before-write is
// what actually prevents one tab from clobbering another's edit; this just
// keeps each tab's `$documents` (and hence the drawer list) from going
// stale. Deliberately does not touch the actively-edited content — pushing
// a remote update into the editor mid-keystroke would be its own hazard.
const documentBroadcastReceived = createEvent<db.DocumentBroadcast>()
db.subscribeToDocumentBroadcasts((message) => documentBroadcastReceived(message))

$documents.on(documentBroadcastReceived, (docs, message) => {
  if (message.type === 'delete') {
    return docs.filter((doc) => doc.id !== message.id)
  }
  const incoming = message.document
  const existing = docs.find((doc) => doc.id === incoming.id)
  if (existing === undefined) return [incoming, ...docs]
  // Stale/out-of-order broadcast — this tab's copy is already at least as
  // new, so keep it rather than regress.
  if (incoming.updatedAt <= existing.updatedAt) return docs
  return docs.map((doc) => (doc.id === incoming.id ? incoming : doc))
})

// --- Selecting a document ------------------------------------------------

$drawerOpen.on(documentSelected, () => false)

// Resolve a selection against the *current* (pre-switch) state in one pure
// step, then apply it downstream. `$activeId` is deliberately NOT reduced
// directly on `documentSelected`: if it were, this `sample`'s own `source`
// read of `$activeId` could see the already-updated value and wrongly decide
// the document didn't change (Effector applies same-event `.on` updates
// before a `sample` reading that store as source). Driving `$activeId` from
// the resolved event below keeps the "did it actually change?" check honest.
sample({
  clock: documentSelected,
  source: { docs: $documents, activeId: $activeId },
  filter: ({ docs }, id) => docs.some((doc) => doc.id === id),
  fn: ({ docs, activeId }, id) => ({
    id,
    changed: id !== activeId,
    content: docs.find((doc) => doc.id === id)?.content ?? '',
  }),
  target: documentSwitchResolved,
})

$activeId.on(documentSwitchResolved, (_, resolved) => resolved.id)

// Only reload the editor when the document genuinely changed — re-clicking
// the active document must not reset its cursor/scroll.
sample({
  clock: documentSwitchResolved,
  filter: (resolved) => resolved.changed,
  fn: (resolved) => resolved.content,
  target: activeDocumentLoaded,
})

sample({ clock: documentSwitchResolved, fn: (resolved) => resolved.id, target: persistActiveIdFx })

// --- Creating / duplicating (both prepend + activate + load) -------------

sample({ clock: documentCreated, fn: () => makeEmpty(), target: documentAdded })

sample({
  clock: documentDuplicated,
  source: $documents,
  filter: (docs, id) => docs.some((doc) => doc.id === id),
  fn: (docs, id): MarkdownDocument => {
    const source = docs.find((doc) => doc.id === id)
    const now = Date.now()
    return {
      id: createId(),
      title: `${source?.title ?? 'Untitled'} (copy)`,
      content: source?.content ?? '',
      createdAt: now,
      updatedAt: now,
    }
  },
  target: documentAdded,
})

$documents.on(documentAdded, (docs, doc) => [doc, ...docs])
$activeId.on(documentAdded, (_, doc) => doc.id)
$drawerOpen.on(documentAdded, () => false)
// A brand-new id can't already have a record on disk, so there's no
// meaningful "base" to protect against — 0 always satisfies the guard.
sample({
  clock: documentAdded,
  fn: (doc): SavePayload => ({ doc, base: 0 }),
  target: saveDocumentFx,
})
sample({ clock: documentAdded, fn: (doc) => doc.id, target: persistActiveIdFx })
sample({ clock: documentAdded, fn: (doc) => doc.content, target: activeDocumentLoaded })

// --- Renaming ------------------------------------------------------------

sample({
  clock: documentRenamed,
  source: $documents,
  filter: (docs, { id }) => docs.some((doc) => doc.id === id),
  fn: (docs, { id, title }): MarkdownDocument => {
    const existing = docs.find((doc) => doc.id === id) as MarkdownDocument
    const trimmed = title.trim()
    return {
      ...existing,
      title: trimmed === '' ? existing.title : trimmed,
      updatedAt: Date.now(),
    }
  },
  target: documentRenameApplied,
})

$documents.on(documentRenameApplied, (docs, renamed) =>
  docs.map((doc) => (doc.id === renamed.id ? renamed : doc)),
)
// Renames persist immediately and independently of the active document's
// content autosave (see `documentRenameApplied` above).
sample({
  clock: documentRenameApplied,
  source: $knownDiskUpdatedAt,
  fn: (known, renamed): SavePayload => ({ doc: renamed, base: known[renamed.id] ?? 0 }),
  target: saveDocumentFx,
})

// --- Deleting (with confirmation) ----------------------------------------

$pendingDelete.on(documentDeleteRequested, (_, id) => id)
$pendingDelete.reset(documentDeleteCancelled)

// On confirm, compute the entire next state in one pure step from the
// pre-delete snapshot, then apply it via a single downstream event. Deleting
// the active document activates the most-recent survivor; deleting the last
// document auto-creates a fresh empty one so the app is never left blank.
sample({
  clock: documentDeleteConfirmed,
  source: { pending: $pendingDelete, docs: $documents, activeId: $activeId },
  filter: ({ pending }) => pending !== null,
  fn: ({ pending, docs, activeId }): AfterDelete => {
    const deletedId = pending as string
    const remaining = docs.filter((doc) => doc.id !== deletedId)

    if (remaining.length === 0) {
      const fresh = makeEmpty()
      return {
        documents: [fresh],
        activeId: fresh.id,
        deletedId,
        loadContent: fresh.content,
        createdDoc: fresh,
      }
    }
    // Including the `null` guard here narrows `activeId` to `string` for the
    // fall-through return below (and defends against an unset active id).
    if (activeId === null || activeId === deletedId) {
      const next = mostRecent(remaining)
      return {
        documents: remaining,
        activeId: next.id,
        deletedId,
        loadContent: next.content,
        createdDoc: null,
      }
    }
    return { documents: remaining, activeId, deletedId, loadContent: null, createdDoc: null }
  },
  target: documentDeleteApplied,
})

$documents.on(documentDeleteApplied, (_, next) => next.documents)
$activeId.on(documentDeleteApplied, (_, next) => next.activeId)
$pendingDelete.reset(documentDeleteApplied)

sample({ clock: documentDeleteApplied, fn: (next) => next.deletedId, target: deleteDocumentFx })
sample({ clock: documentDeleteApplied, fn: (next) => next.activeId, target: persistActiveIdFx })
sample({
  clock: documentDeleteApplied,
  filter: (next) => next.createdDoc !== null,
  // Brand-new id, nothing on disk yet — same as `documentAdded`, base 0
  // always satisfies the guard.
  fn: (next): SavePayload => ({ doc: next.createdDoc as MarkdownDocument, base: 0 }),
  target: saveDocumentFx,
})
sample({
  clock: documentDeleteApplied,
  filter: (next) => next.loadContent !== null,
  fn: (next) => next.loadContent as string,
  target: activeDocumentLoaded,
})

// --- Drawer --------------------------------------------------------------

$drawerOpen.on(drawerToggled, (open) => !open).on(drawerClosed, () => false)

// --- Init ----------------------------------------------------------------

/** Kick off the restore/seed. Called once from `src/app/wiring.ts`. */
export function initDocuments(options: InitOptions): void {
  loadFx(options)
}

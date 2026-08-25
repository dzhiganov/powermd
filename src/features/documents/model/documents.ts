import { combine, createEffect, createEvent, createStore, sample } from 'effector'
import { debounce } from 'patronum'

import { readStorage, writeStorage } from '@/shared/lib/storage'

import * as db from '../lib/db'
import { createId } from '../lib/id'
import { deriveTitle } from '../lib/title'
import type { Folder, GitHubOrigin, MarkdownDocument, SaveStatus } from './types'

/** Autosave debounce default: writes land ~500ms after typing pauses,
 * never on every keystroke. A document switch flushes any still-pending
 * write first (see the flush `sample` below). The debounced tick itself
 * can't be cancelled (patronum's `debounce` exposes no external cancel), so
 * a delete that fires mid-debounce is handled by dropping the tick instead
 * — see the `autosaveTick` sample below. A `pagehide`/`visibilitychange`/
 * localStorage mirror (further down) covers the reload-before-the-debounce
 * -fires case. Overridable at runtime via `autosaveIntervalChanged` — see
 * `$autosaveIntervalMs` below, driven from `features/settings`' persisted
 * preference through `src/app/wiring.ts`. */
const AUTOSAVE_MS = 500

/** localStorage key for the synchronous mirror of `$pendingSave`. IndexedDB
 * writes are not guaranteed to complete during unload, but localStorage is
 * synchronous — so it is the safety net for "edited, then reloaded/closed
 * before the debounce (or the unload flush) landed". */
const PENDING_SAVE_KEY = 'markdown-editor:pendingSave'

/** localStorage key for the drawer's persisted open/closed state — see
 * `$drawerOpen` below. */
const DRAWER_OPEN_KEY = 'markdown-editor:drawer-open'

/** localStorage key for the set of collapsed folder ids — see
 * `$collapsedFolderIds` below. */
const COLLAPSED_FOLDERS_KEY = 'markdown-editor:collapsed-folders'

// --- Public intents (fired from UI / wiring) -----------------------------

/** Create a new empty document and make it active. */
export const documentCreated = createEvent()
/** Make the document with this id active (a drawer click). */
export const documentSelected = createEvent<string>()
/** Rename a document. */
export const documentRenamed = createEvent<{ id: string; title: string }>()
/** Duplicate a document and make the copy active. */
export const documentDuplicated = createEvent<string>()
/**
 * Create a document from imported file content (drag-drop or the file
 * picker, see `src/features/transfer`) and make it active — the same
 * "prepend + activate + persist" shape as `documentCreated`/
 * `documentDuplicated` below, just seeded from the given title/content
 * instead of empty/copied. Always creates a *new* document, never
 * overwrites the active one — dropping a file onto an editor with unsaved
 * work must never silently discard it.
 */
export const documentImported = createEvent<{ title: string; content: string }>()
/**
 * First-connect GitHub sync import: every markdown file in the connected
 * repo (under the configured subfolder) that isn't already linked to a local
 * document becomes a brand-new one, pre-linked to the exact remote path it
 * came from (so a later sync re-check never re-imports it — see
 * `features/github/model/import.ts`). `dirPath`, if non-null, is the
 * (possibly multi-segment, e.g. `"notes/2024"`) repo directory the file
 * lived in relative to the subfolder root; a folder whose `syncDirPath`
 * already equals it is reused, otherwise a new one is created and given that
 * `syncDirPath` — same one-flat-level-per-directory-string simplification as
 * every other folder in this app (see `Folder`'s doc comment: folders don't
 * nest, so a nested repo directory becomes one folder named after its full
 * relative path rather than a chain of nested folders). Fired from
 * `src/app/wiring.ts` off `features/github`'s `importCompleted`.
 */
export const documentsBulkImported =
  createEvent<{ title: string; content: string; dirPath: string | null; origin: GitHubOrigin }[]>()
/**
 * Bulk write-back of newly-assigned (or hash-refreshed) GitHub origins —
 * covers both "this document had no sync slot yet, here's the one it now
 * owns forever" and "this document was just pushed, here's its new
 * `syncedHash`". Metadata only in both cases — deliberately does *not* bump
 * `updatedAt` (same reasoning as `documentMoveRequested`: assigning or
 * confirming a sync slot isn't a content edit, so the most-recently-updated
 * sort order must not reshuffle because of it) and never touches the editor.
 * Fired from `src/app/wiring.ts` off `features/github`'s `originsAssigned`
 * (path assignment) and `pushCompleted` (hash refresh after a commit).
 */
export const documentGithubOriginsApplied = createEvent<{ id: string; origin: GitHubOrigin }[]>()
/**
 * Bulk write-back of newly-assigned folder `syncDirPath`s — same "assigned
 * once, fixed forever, metadata only" shape as
 * `documentGithubOriginsApplied` above, just for folders. Fired from
 * `src/app/wiring.ts` off `features/github`'s `folderDirsAssigned`.
 */
export const folderSyncDirPathsApplied = createEvent<{ id: string; syncDirPath: string }[]>()
/** Ask to delete a document — opens the confirmation step, deletes nothing
 * yet (deletion is irreversible, so it always requires confirmation). */
export const documentDeleteRequested = createEvent<string>()
/** Confirm the pending deletion. */
export const documentDeleteConfirmed = createEvent()
/** Cancel the pending deletion. */
export const documentDeleteCancelled = createEvent()

export const drawerToggled = createEvent()
export const drawerClosed = createEvent()
/** Opens the drawer unconditionally (a no-op if already open) — unlike
 * `drawerToggled`, which would *close* it if called while already open.
 * Fired from `src/app/documentsSearchShortcut.ts`'s global Ctrl+Shift+F/
 * Cmd+Shift+F handler, which always wants "open, if not already", never a
 * toggle. */
export const drawerOpened = createEvent()

// --- Folders (flat — a document is at root or in exactly one folder, no
// nesting) -----------------------------------------------------------------

/** Create a folder with this name (blank falls back to "Untitled folder",
 * same shape as a blank rename — see `documentRenamed`). */
export const folderCreated = createEvent<string>()
/** Rename a folder. */
export const folderRenamed = createEvent<{ id: string; name: string }>()
/** Ask to delete a folder — opens the confirmation step; deletes nothing yet.
 * Deleting a folder never deletes the documents inside it (they move to
 * root), but it's still irreversible as a grouping, so it's confirmed the
 * same way document deletion is. */
export const folderDeleteRequested = createEvent<string>()
export const folderDeleteConfirmed = createEvent()
export const folderDeleteCancelled = createEvent()
/** Toggle a folder's collapsed/expanded state in the sidebar. */
export const folderCollapseToggled = createEvent<string>()
/** Move a document to a folder, or to root when `folderId` is `null` — the
 * drawer's per-row "Move to folder" action. */
export const documentMoveRequested = createEvent<{ id: string; folderId: string | null }>()

/** Save whatever is currently pending immediately, bypassing the autosave
 * debounce below. Fired from the editor feature's Mod-S binding
 * (`features/editor`' `saveNowRequested`) via `src/app/wiring.ts`. A no-op
 * if nothing is pending. */
export const saveRequested = createEvent()

/** Overrides the autosave debounce interval (default `AUTOSAVE_MS` above).
 * Fired from `src/app/wiring.ts`, sourced from `features/settings`'
 * persisted "Autosave delay" preference. */
export const autosaveIntervalChanged = createEvent<number>()

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

// A brand-new folder to append + persist.
const folderAdded = createEvent<Folder>()
// A rename applied as a full snapshot, same shape as `documentRenameApplied`.
const folderRenameApplied = createEvent<Folder>()
// A move applied as a full document snapshot (only `folderId` — and
// `updatedAt` is deliberately *not* bumped, see `documentMoveRequested`'s
// sample below). Same "resolve then apply" shape as `documentRenameApplied`.
const documentMoveApplied = createEvent<MarkdownDocument>()
// GitHub-sync origin updates resolved against current state, as the full set
// of changed document snapshots — bulk counterpart of `documentMoveApplied`
// above, same "origin changes, `updatedAt` doesn't" reasoning.
const documentOriginsResolved = createEvent<MarkdownDocument[]>()
// Same shape, for folders' `syncDirPath`.
const folderSyncDirPathsResolved = createEvent<Folder[]>()
// A first-connect import batch resolved into the brand-new folders and
// documents it needs to create — see `resolveBulkImport` and the
// `documentsBulkImported` sample below.
const bulkImportResolved = createEvent<{ newFolders: Folder[]; newDocs: MarkdownDocument[] }>()

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
// Exported (but not re-exported from this feature's `index.ts` — see
// ARCHITECTURE.md's boundary rule 1, which only checks the FEATURE
// boundary, not file-level privacy within one) so `model/bookmarks.ts`, in
// this same feature, can react to "a document was deleted" without a
// second, parallel notion of the same event — it needs the exact same
// pre-computed `deletedId` this one already carries, not a fresh derivation
// that could disagree with it.
export const documentDeleteApplied = createEvent<AfterDelete>()

// --- Helpers -------------------------------------------------------------

function makeWelcome(content: string): MarkdownDocument {
  const now = Date.now()
  return {
    id: createId(),
    title: deriveTitle(content) || 'Welcome',
    content,
    createdAt: now,
    updatedAt: now,
    folderId: null,
    origin: null,
  }
}

/**
 * `folderId` is the folder a brand-new document should land in. Callers
 * decide what that should be — see `documentCreated`'s sample below for the
 * "new document" placement rule (follows the active document's folder), and
 * the delete-flow's use of this for the "last document deleted" auto-create
 * (always root — see that sample's own comment for why).
 */
function makeEmpty(folderId: string | null): MarkdownDocument {
  const now = Date.now()
  return {
    id: createId(),
    title: 'Untitled',
    content: '',
    createdAt: now,
    updatedAt: now,
    folderId,
    // A brand-new empty document is always local-only — nothing opened it
    // from an external source.
    origin: null,
  }
}

function makeFolder(name: string): Folder {
  const trimmed = name.trim()
  return {
    id: createId(),
    name: trimmed === '' ? 'Untitled folder' : trimmed,
    createdAt: Date.now(),
    // A folder created by hand has no remote directory yet — GitHub sync
    // assigns one lazily, the first time a document inside it is synced.
    syncDirPath: null,
  }
}

function mostRecent(docs: MarkdownDocument[]): MarkdownDocument {
  return docs.reduce((latest, doc) => (doc.updatedAt > latest.updatedAt ? doc : latest))
}

/**
 * Resolves one first-connect import batch (see `documentsBulkImported`'s doc
 * comment) into the brand-new folders and documents it needs, in a single
 * pure pass against the *current* folder list — so that when two imported
 * files share the same `dirPath` (e.g. `notes/2024/a.md` and
 * `notes/2024/b.md`), they resolve to the one new folder created for
 * `"notes/2024"` rather than each creating (and orphaning) their own. Folders
 * already carrying that `syncDirPath` (an already-imported directory, or one
 * a local folder happened to already own) are reused instead of duplicated.
 */
function resolveBulkImport(
  existingFolders: Folder[],
  items: { title: string; content: string; dirPath: string | null; origin: GitHubOrigin }[],
): { newFolders: Folder[]; newDocs: MarkdownDocument[] } {
  const dirPathToFolderId = new Map(
    existingFolders
      .filter((folder): folder is Folder & { syncDirPath: string } => folder.syncDirPath !== null)
      .map((folder) => [folder.syncDirPath, folder.id]),
  )
  const newFolders: Folder[] = []
  const newDocs: MarkdownDocument[] = []

  for (const item of items) {
    let folderId: string | null = null
    if (item.dirPath !== null) {
      const existingId = dirPathToFolderId.get(item.dirPath)
      if (existingId !== undefined) {
        folderId = existingId
      } else {
        const now = Date.now()
        const folder: Folder = {
          id: createId(),
          name: item.dirPath,
          createdAt: now,
          syncDirPath: item.dirPath,
        }
        newFolders.push(folder)
        dirPathToFolderId.set(item.dirPath, folder.id)
        folderId = folder.id
      }
    }
    const now = Date.now()
    const trimmed = item.title.trim()
    newDocs.push({
      id: createId(),
      title: trimmed === '' ? 'Untitled' : trimmed,
      content: item.content,
      createdAt: now,
      updatedAt: now,
      folderId,
      origin: item.origin,
    })
  }

  return { newFolders, newDocs }
}

/** The drawer defaults to *open* (see `DocumentDrawer.vue`'s docked/overlay
 * rework) — an unset key means "never closed it", not "closed". Once the
 * user closes it, that choice persists across reloads. */
function readInitialDrawerOpen(): boolean {
  const stored = readStorage(DRAWER_OPEN_KEY)
  if (stored === null) return true
  return stored === 'true'
}

/** Reads the persisted set of collapsed folder ids. Defensive about missing/
 * malformed JSON — a corrupt value just means "nothing collapsed", never a
 * thrown error. */
function readInitialCollapsedFolderIds(): string[] {
  const stored = readStorage(COLLAPSED_FOLDERS_KEY)
  if (stored === null) return []
  try {
    const parsed: unknown = JSON.parse(stored)
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : []
  } catch {
    return []
  }
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
    const candidate = parsed as MarkdownDocument
    // A mirror written before folders/origins existed has no `folderId`/
    // `origin` at all — same normalization `db.ts`'s `normalizeDocument`
    // applies on read, done here too since this path never goes through that
    // function.
    return {
      ...candidate,
      folderId: typeof candidate.folderId === 'string' ? candidate.folderId : null,
      origin: coerceOrigin(candidate.origin),
    }
  } catch {
    return null
  }
}

/** Second-line-of-defense origin validation for the localStorage recovery
 * mirror (which never goes through `db.ts`'s `normalizeDocument`). Mirrors
 * that function's `normalizeOrigin`: anything not matching the full origin
 * shape — partial, malformed, future-shaped — is treated as local-only. */
function coerceOrigin(value: unknown): GitHubOrigin | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const stringFields = ['owner', 'repo', 'branch', 'path'] as const
  for (const field of stringFields) {
    if (typeof raw[field] !== 'string' || raw[field] === '') return null
  }
  if (raw.syncedHash !== null && (typeof raw.syncedHash !== 'string' || raw.syncedHash === '')) {
    return null
  }
  return {
    owner: raw.owner as string,
    repo: raw.repo as string,
    branch: raw.branch as string,
    path: raw.path as string,
    syncedHash: raw.syncedHash as string | null,
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
export const $drawerOpen = createStore(readInitialDrawerOpen())

export const $folders = createStore<Folder[]>([])
/** Folder id awaiting delete confirmation, or null when no confirm is
 * open — same shape as `$pendingDelete` above. */
export const $pendingFolderDelete = createStore<string | null>(null)
/** Ids of folders currently collapsed in the sidebar, persisted across
 * reloads. */
export const $collapsedFolderIds = createStore<string[]>(readInitialCollapsedFolderIds())
  .on(folderCollapseToggled, (ids, id) =>
    ids.includes(id) ? ids.filter((collapsedId) => collapsedId !== id) : [...ids, id],
  )
  // Prune ids for folders that no longer exist, so a deleted folder's id
  // doesn't linger in localStorage forever.
  .on($folders, (ids, folders) => ids.filter((id) => folders.some((folder) => folder.id === id)))

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

export const $pendingFolderDeleteDoc = combine($folders, $pendingFolderDelete, (folders, id) =>
  id === null ? null : (folders.find((folder) => folder.id === id) ?? null),
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
const saveFolderFx = createEffect((folder: Folder) => db.putFolder(folder))
// Plural counterparts of `saveDocumentFx`/`saveFolderFx` for the GitHub sync
// bulk-write flows (origin/syncDirPath assignment, first-connect import) —
// same per-record staleness guard as `saveDocumentFx` (via `db.putDocument`'s
// own `base` check), just batched into one effect call instead of N so
// `$knownDiskUpdatedAt`/`$persistError` only have to react to one settle per
// batch rather than racing N independent ones.
const saveManyDocumentsFx = createEffect((payloads: SavePayload[]) =>
  Promise.all(payloads.map(({ doc, base }) => db.putDocument(doc, base))),
)
const saveManyFoldersFx = createEffect((folders: Folder[]) =>
  Promise.all(folders.map((folder) => db.putFolder(folder))),
)
// Returns the documents that were moved to root, so `$documents` can be
// updated from the actual write result rather than re-deriving it — see the
// `deleteFolderFx.done` handlers below.
const deleteFolderFx = createEffect((folderId: string) =>
  db.deleteFolderAndOrphanDocuments(folderId),
)

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
    folders: Folder[]
    activeId: string
    persistent: boolean
    /** True when the load failed specifically because another tab is
     * blocking the upgrade (see `db.DatabaseBlockedError`) — surfaced
     * distinctly from a generic "storage unavailable" failure. */
    blocked: boolean
  }> => {
    try {
      const [docs, folders, storedActiveId] = await Promise.all([
        db.getAllDocuments(),
        db.getAllFolders(),
        db.getActiveId(),
      ])

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
        return { documents, folders, activeId, persistent: true, blocked: false }
      }
      // First run: seed and persist the welcome document.
      const welcome = makeWelcome(welcomeContent)
      await db.putDocument(welcome, welcome.updatedAt)
      await db.setActiveId(welcome.id)
      return {
        documents: [welcome],
        folders,
        activeId: welcome.id,
        persistent: true,
        blocked: false,
      }
    } catch (error) {
      // A blocked upgrade is recoverable (close the other tab and reload)
      // and must never be reported the same way as genuine unavailability
      // — see `db.DatabaseBlockedError`'s doc comment. Both paths still
      // fall back to an in-memory welcome document so the app is usable
      // either way; only the surfaced message differs (see `$dbBlocked`
      // below).
      const blocked = error instanceof db.DatabaseBlockedError
      console.error(
        blocked
          ? '[documents] IndexedDB open blocked by another tab — running in-memory until it closes'
          : '[documents] IndexedDB unavailable — running in-memory only',
        error,
      )
      const welcome = makeWelcome(welcomeContent)
      return { documents: [welcome], folders: [], activeId: welcome.id, persistent: false, blocked }
    }
  },
)

// --- Persistence error tracking ------------------------------------------

$persistError
  .on(
    [
      saveDocumentFx.fail,
      deleteDocumentFx.fail,
      persistActiveIdFx.fail,
      saveManyDocumentsFx.fail,
      saveManyFoldersFx.fail,
    ],
    () => true,
  )
  .on(
    [
      saveDocumentFx.done,
      deleteDocumentFx.done,
      persistActiveIdFx.done,
      saveManyDocumentsFx.done,
      saveManyFoldersFx.done,
    ],
    () => false,
  )
  .on(loadFx.doneData, (_, { persistent }) => !persistent)

// True while the initial open is being held up by another tab still
// running an older version (`db.DatabaseBlockedError`/`onblocked` — see
// `lib/db.ts`). Flips true the moment the block is first reported, well
// before `loadFx` itself settles (it waits out a grace period before
// giving up), so the UI can show a specific, actionable message ("close
// your other tab") from the first instant instead of looking hung. Stays
// true if `loadFx` eventually gives up and falls back to in-memory (see its
// `blocked` result) — that fallback must stay visibly explained, not
// silent — and only clears once a load genuinely succeeds against real
// storage.
const databaseBlockedNotified = createEvent()
db.subscribeToDatabaseBlocked(() => databaseBlockedNotified())

export const $dbBlocked = createStore(false)
  .on(databaseBlockedNotified, () => true)
  .on(loadFx.doneData, (_, { persistent, blocked }) => (persistent ? false : blocked))

// This tab's own confirmed-on-disk knowledge: seeded from the initial read,
// then advanced only by this tab's own writes (see `$knownDiskUpdatedAt`'s
// doc comment for why broadcasts must not feed it too).
$knownDiskUpdatedAt
  .on(loadFx.doneData, (_, { documents }) =>
    Object.fromEntries(documents.map((doc) => [doc.id, doc.updatedAt])),
  )
  .on(saveDocumentFx.done, (known, { result }) => ({ ...known, [result.id]: result.diskUpdatedAt }))
  .on(saveManyDocumentsFx.done, (known, { result }) => {
    const next = { ...known }
    for (const putResult of result) next[putResult.id] = putResult.diskUpdatedAt
    return next
  })
  .on(deleteDocumentFx.done, (known, { params: id }) => {
    if (!(id in known)) return known
    const rest = { ...known }
    delete rest[id]
    return rest
  })

// --- Initial load / seed -------------------------------------------------

$documents.on(loadFx.doneData, (_, { documents }) => documents)
$activeId.on(loadFx.doneData, (_, { activeId }) => activeId)
$folders.on(loadFx.doneData, (_, { folders }) => folders)

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
      folderId: existing?.folderId ?? null,
      // Editing a GitHub-opened document keeps it linked to its origin — the
      // recorded sha stays the base for the next commit; only committing
      // back (or explicitly reloading remote) advances it.
      origin: existing?.origin ?? null,
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

/** Live autosave interval, defaulting to `AUTOSAVE_MS` and overridable via
 * `autosaveIntervalChanged` (see above). Passed to patronum's `debounce` as
 * a `Store<number>` rather than a plain number — patronum reads the
 * store's *current* value each time the debounce re-arms, which is what
 * lets a settings change take effect on the very next edit instead of
 * requiring a reload. */
const $autosaveIntervalMs = createStore(AUTOSAVE_MS).on(autosaveIntervalChanged, (_, ms) => ms)

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
const autosaveTick = debounce(documentTouched, $autosaveIntervalMs)
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
// Same clearing rule as above, for the plural bulk-write path — a GitHub
// sync metadata write can incidentally persist a document's latest in-memory
// content too (it reads from `$documents`, which already has any pending
// edit applied), so the pending marker has to be able to clear from this
// path as well, not just `saveDocumentFx.done`.
$pendingSave.on(saveManyDocumentsFx.done, (pending, { params, result }) => {
  if (pending === null) return pending
  const index = params.findIndex((payload) => payload.doc.id === pending.id)
  if (index === -1) return pending
  return result[index].diskUpdatedAt >= pending.updatedAt ? null : pending
})

// --- Immediate save (Mod-S) -------------------------------------------------
//
// Same shape as the autosave tick above, just triggered explicitly instead
// of by the debounce timer — "save now" only makes sense while something is
// actually pending.
sample({
  clock: saveRequested,
  source: { pending: $pendingSave, known: $knownDiskUpdatedAt },
  filter: ({ pending }) => pending !== null,
  fn: ({ pending, known }): SavePayload => {
    const doc = pending as MarkdownDocument
    return { doc, base: known[doc.id] ?? 0 }
  },
  target: saveDocumentFx,
})

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
//
// On mobile, selecting/creating/duplicating/importing a document also closes
// the (overlay) drawer — but that decision needs `layout`'s desktop/mobile
// breakpoint, which this feature has no notion of, so it's wired in
// `src/app/wiring.ts` instead of reduced here directly.

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

// New-document placement rule: a document created via "+ New" lands in
// whichever folder the *active* document is currently in (root if the
// active document is at root, or if there is no active document yet). The
// active document is the closest thing this app has to "the folder you're
// currently working in" — there's no separate folder-selection concept
// (folders are just collapsible groups in the sidebar, and moving is a
// per-document menu action, not drag-and-drop) — so continuing to create
// alongside whatever you were just editing is the only rule that has
// anything to key off of, and matches "new document" reading as "another
// one like this" rather than "always back to the top level".
sample({
  clock: documentCreated,
  source: { docs: $documents, activeId: $activeId },
  fn: ({ docs, activeId }) => {
    const active = activeId === null ? undefined : docs.find((doc) => doc.id === activeId)
    return makeEmpty(active?.folderId ?? null)
  },
  target: documentAdded,
})

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
      // A duplicate is a copy of its source, so it stays alongside it —
      // same reasoning as `documentCreated`'s placement rule above, just
      // keyed off the document being duplicated instead of the active one.
      folderId: source?.folderId ?? null,
      // A duplicate is a *fresh local copy*, never a second handle to the
      // same GitHub file — origin is deliberately dropped. Two documents
      // sharing one origin (same path + sha) would fight over that remote
      // file: committing one would strand the other with a stale sha. Only
      // the original stays linked to GitHub.
      origin: null,
    }
  },
  target: documentAdded,
})

sample({
  clock: documentImported,
  fn: ({ title, content }): MarkdownDocument => {
    const now = Date.now()
    const trimmed = title.trim()
    return {
      id: createId(),
      title: trimmed === '' ? 'Untitled' : trimmed,
      content,
      createdAt: now,
      updatedAt: now,
      // Imported files always land at root — an import has no "current
      // folder" to inherit from (it can arrive via drag-drop anywhere in
      // the window), unlike `documentCreated`/`documentDuplicated` above.
      folderId: null,
      // An imported (drag-drop / file picker) document is always local-only —
      // GitHub sync's own import path is `documentsBulkImported`, below.
      origin: null,
    }
  },
  target: documentAdded,
})

$documents.on(documentAdded, (docs, doc) => [doc, ...docs])
$activeId.on(documentAdded, (_, doc) => doc.id)
// Mobile-only auto-close on creation is wired in `src/app/wiring.ts` (see
// the "Selecting a document" comment above) — not reduced here.
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
    // An empty rename falls back to "Untitled", not the pre-rename title —
    // silently keeping the old title would look like the rename was
    // accepted while actually discarding it.
    return {
      ...existing,
      title: trimmed === '' ? 'Untitled' : trimmed,
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
      // Root, not the deleted document's former folder — the folder itself
      // may still exist (deleting a document doesn't delete its folder),
      // but "every document is gone" has no more specific context left to
      // inherit than root.
      const fresh = makeEmpty(null)
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

$drawerOpen
  .on(drawerToggled, (open) => !open)
  .on(drawerClosed, () => false)
  .on(drawerOpened, () => true)

const persistDrawerOpenFx = createEffect((open: boolean) => {
  writeStorage(DRAWER_OPEN_KEY, String(open))
})

sample({ clock: $drawerOpen, target: persistDrawerOpenFx })

const persistCollapsedFoldersFx = createEffect((ids: string[]) => {
  writeStorage(COLLAPSED_FOLDERS_KEY, JSON.stringify(ids))
})

sample({ clock: $collapsedFolderIds, target: persistCollapsedFoldersFx })

// --- Folders: creating / renaming -----------------------------------------

sample({ clock: folderCreated, fn: (name) => makeFolder(name), target: folderAdded })

$folders.on(folderAdded, (folders, folder) => [...folders, folder])
sample({ clock: folderAdded, target: saveFolderFx })

sample({
  clock: folderRenamed,
  source: $folders,
  filter: (folders, { id }) => folders.some((folder) => folder.id === id),
  fn: (folders, { id, name }): Folder => {
    const existing = folders.find((folder) => folder.id === id) as Folder
    const trimmed = name.trim()
    // Same "blank falls back to a default, never silently keeps the old
    // name" shape as `documentRenamed` above.
    return { ...existing, name: trimmed === '' ? 'Untitled folder' : trimmed }
  },
  target: folderRenameApplied,
})

$folders.on(folderRenameApplied, (folders, renamed) =>
  folders.map((folder) => (folder.id === renamed.id ? renamed : folder)),
)
sample({ clock: folderRenameApplied, target: saveFolderFx })

// --- Folders: deleting (with confirmation) --------------------------------
//
// Deleting a folder never deletes the documents inside it — they move to
// root. `db.deleteFolderAndOrphanDocuments` does both the folder deletion
// and every affected document's `folderId` update inside one IndexedDB
// transaction (see its doc comment for why that's what actually closes the
// "stale write recreates a deleted folder, or orphans a document into a
// missing folder id" hazard at the storage layer) — this wiring just
// reflects that same already-atomic result into the in-memory stores from
// `deleteFolderFx.done`, rather than recomputing it from local state (which
// would risk disagreeing with what was actually written).

$pendingFolderDelete.on(folderDeleteRequested, (_, id) => id)
$pendingFolderDelete.reset(folderDeleteCancelled)

sample({
  clock: folderDeleteConfirmed,
  source: $pendingFolderDelete,
  filter: (id): id is string => id !== null,
  target: deleteFolderFx,
})

$pendingFolderDelete.reset(deleteFolderFx.done)
$folders.on(deleteFolderFx.done, (folders, { params: folderId }) =>
  folders.filter((folder) => folder.id !== folderId),
)
// `deleteFolderFx`'s result is exactly the set of documents the DB
// transaction actually moved to root — applying that (rather than a fresh
// `folderId === deletedId ? null : ...` sweep over the pre-delete list)
// keeps this tab's in-memory copy identical to what's really on disk.
$documents.on(deleteFolderFx.done, (docs, { result: orphaned }) =>
  docs.map((doc) => orphaned.find((moved) => moved.id === doc.id) ?? doc),
)

// --- Folders: collapse/expand ----------------------------------------------
// (Persistence for `$collapsedFolderIds` is the `persistCollapsedFoldersFx`
// sample above; the toggle reducer itself lives on the store's own
// definition next to `$folders`.)

// --- Moving a document to a folder (or back to root) ----------------------
//
// Same shape as renaming: resolve against current state, apply as one full
// snapshot, persist immediately and independently of the active document's
// content autosave. `updatedAt` is deliberately left unchanged — a move is
// a metadata change, not an edit, and touching it would reshuffle the
// most-recently-updated sort order for something the user didn't actually
// edit.
sample({
  clock: documentMoveRequested,
  source: { docs: $documents, folders: $folders },
  filter: ({ docs, folders }, { id, folderId }) =>
    docs.some((doc) => doc.id === id) &&
    (folderId === null || folders.some((folder) => folder.id === folderId)),
  fn: ({ docs }, { id, folderId }): MarkdownDocument => {
    const existing = docs.find((doc) => doc.id === id) as MarkdownDocument
    return { ...existing, folderId }
  },
  target: documentMoveApplied,
})

$documents.on(documentMoveApplied, (docs, moved) =>
  docs.map((doc) => (doc.id === moved.id ? moved : doc)),
)
sample({
  clock: documentMoveApplied,
  source: $knownDiskUpdatedAt,
  fn: (known, moved): SavePayload => ({ doc: moved, base: known[moved.id] ?? 0 }),
  target: saveDocumentFx,
})
// The active document is never touched by any of the above — `$activeId`
// has no reducer keyed on `documentMoveApplied` — so it stays active across
// a move, whether or not it's the document being moved.

// --- GitHub sync: bulk origin / syncDirPath write-back ---------------------
//
// `documentGithubOriginsApplied` covers two cases from `features/github`'s
// sync engine, both metadata-only writes with `updatedAt` deliberately left
// unchanged (same reasoning as `documentMoveApplied` above — neither is a
// content edit, so neither should reshuffle the most-recently-updated sort
// order): a document being assigned its fixed sync path for the very first
// time, and an already-assigned document's `syncedHash` catching up after a
// successful push. Ids that no longer resolve to a document (deleted between
// the sync engine reading its snapshot and this landing) are silently
// dropped — same as every other "resolve against current state" flow here.
sample({
  clock: documentGithubOriginsApplied,
  source: $documents,
  fn: (docs, updates): MarkdownDocument[] => {
    const byId = new Map(updates.map((update) => [update.id, update.origin]))
    return docs.reduce<MarkdownDocument[]>((changed, doc) => {
      const origin = byId.get(doc.id)
      if (origin !== undefined) changed.push({ ...doc, origin })
      return changed
    }, [])
  },
  target: documentOriginsResolved,
})

$documents.on(documentOriginsResolved, (docs, updated) => {
  const byId = new Map(updated.map((doc) => [doc.id, doc]))
  return docs.map((doc) => byId.get(doc.id) ?? doc)
})
sample({
  clock: documentOriginsResolved,
  source: $knownDiskUpdatedAt,
  fn: (known, updated): SavePayload[] => updated.map((doc) => ({ doc, base: known[doc.id] ?? 0 })),
  target: saveManyDocumentsFx,
})

// Same shape, for folders — a folder's `syncDirPath` assigned once and never
// again, metadata only.
sample({
  clock: folderSyncDirPathsApplied,
  source: $folders,
  fn: (folders, updates): Folder[] => {
    const byId = new Map(updates.map((update) => [update.id, update.syncDirPath]))
    return folders.reduce<Folder[]>((changed, folder) => {
      const syncDirPath = byId.get(folder.id)
      if (syncDirPath !== undefined) changed.push({ ...folder, syncDirPath })
      return changed
    }, [])
  },
  target: folderSyncDirPathsResolved,
})

$folders.on(folderSyncDirPathsResolved, (folders, updated) => {
  const byId = new Map(updated.map((folder) => [folder.id, folder]))
  return folders.map((folder) => byId.get(folder.id) ?? folder)
})
sample({ clock: folderSyncDirPathsResolved, target: saveManyFoldersFx })

// --- GitHub sync: first-connect import --------------------------------------
//
// Every remote markdown file not already linked to a local document (see
// `features/github/model/import.ts` for the de-dup check against existing
// origins, which is what makes this safe to fire again on a reconnect
// without duplicating anything) becomes a brand-new document here, in one
// atomic resolve step against the current folder list so that two imported
// files under the same new remote directory share one new folder rather than
// each creating their own — see `resolveBulkImport`'s doc comment.
sample({
  clock: documentsBulkImported,
  source: $folders,
  fn: (folders, items) => resolveBulkImport(folders, items),
  target: bulkImportResolved,
})

$folders.on(bulkImportResolved, (folders, { newFolders }) => [...folders, ...newFolders])
// Prepended like `documentAdded`, but — unlike every other add flow — this
// one deliberately does NOT touch `$activeId`: many documents can arrive at
// once, and there is no single "the one the user just created" to activate,
// so whatever was already active stays active.
$documents.on(bulkImportResolved, (docs, { newDocs }) => [...newDocs, ...docs])

sample({
  clock: bulkImportResolved,
  filter: ({ newFolders }) => newFolders.length > 0,
  fn: ({ newFolders }) => newFolders,
  target: saveManyFoldersFx,
})
sample({
  clock: bulkImportResolved,
  filter: ({ newDocs }) => newDocs.length > 0,
  // Brand-new ids, nothing on disk yet — same as `documentAdded`, base 0
  // always satisfies the guard.
  fn: ({ newDocs }): SavePayload[] => newDocs.map((doc) => ({ doc, base: 0 })),
  target: saveManyDocumentsFx,
})

// --- Folders: cross-tab sync -----------------------------------------------
//
// Same shape as the documents cross-tab sync above: keeps `$folders` from
// going stale in other tabs. `deleteFolderAndOrphanDocuments` already
// broadcasts a `put` for every orphaned document on the existing document
// channel, so those tabs' `$documents` catch up via the handler above
// without any folder-specific document handling needed here.
const folderBroadcastReceived = createEvent<db.FolderBroadcast>()
db.subscribeToFolderBroadcasts((message) => folderBroadcastReceived(message))

$folders.on(folderBroadcastReceived, (folders, message) => {
  if (message.type === 'delete') {
    return folders.filter((folder) => folder.id !== message.id)
  }
  const incoming = message.folder
  const existing = folders.find((folder) => folder.id === incoming.id)
  if (existing === undefined) return [...folders, incoming]
  return folders.map((folder) => (folder.id === incoming.id ? incoming : folder))
})

// --- Init ----------------------------------------------------------------

/** Kick off the restore/seed. Called once from `src/app/wiring.ts`. */
export function initDocuments(options: InitOptions): void {
  loadFx(options)
}

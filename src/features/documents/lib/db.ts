import { isHighlightColorId, DEFAULT_HIGHLIGHT_COLOR } from '@/shared/config/highlightColors'

import type { Folder, GitHubOrigin, Highlight, MarkdownDocument } from '../model/types'

/**
 * Thin promise wrapper over raw IndexedDB. Chosen over the `idb` package on
 * purpose: our needs are tiny (one keyed object store for documents, one
 * meta row for the active id), so a dependency buys little, and rolling it
 * by hand lets every entry point fail loudly with a rejected promise that
 * the model turns into a visible error state — which is exactly what the
 * robustness requirement (private browsing / quota / unavailable IDB) needs.
 * Every function rejects rather than throwing synchronously, and the open is
 * lazy and retryable so a transient failure can never wedge the app.
 */

const DB_NAME = 'markdown-editor'
/**
 * v1 -> v2: added the `folders` store and a `folderId` field on every
 * document (see `onupgradeneeded` below for the real migration — every
 * existing document record is walked and given an explicit
 * `folderId: null`, not just left for `normalizeDocument` to paper over on
 * read forever).
 *
 * v2 -> v3: added an `origin` field on every document (`null` = a local-only
 * document, or a `GitHubOrigin` for a document opened from GitHub). Same
 * cursor-walk backfill as v2 (see `onupgradeneeded` below): every existing
 * record is walked and given an explicit `origin: null`. A record still at
 * v1 when a v3 install first opens it is backfilled with *both* `folderId:
 * null` and `origin: null` in the same single pass.
 *
 * v3 -> v4: the old per-file "Save/Commit to GitHub" flow is replaced by
 * automatic one-way sync of every document — see `GitHubOrigin`'s doc
 * comment in `model/types.ts`. Two shape changes ride along:
 *   - `GitHubOrigin` drops the old `sha` field (that flow's per-file
 *     optimistic-concurrency token, meaningless to the new batched-commit
 *     engine) and gains `syncedHash` (the content hash last pushed to
 *     `path`). A v3 record's `origin`, if it has one, already carries the
 *     right `owner`/`repo`/`branch`/`path` — those are kept as-is, so a
 *     document already linked to a file keeps that same fixed path; only
 *     `sha` is dropped and `syncedHash` seeded `null` (meaning "not
 *     confirmed synced under the new engine yet" — the next sync cycle
 *     re-pushes it, which is harmless: same path, same content, an
 *     idempotent no-op commit at worst).
 *   - Every folder gains a `syncDirPath` field (`null` until sync assigns
 *     one), same "backfill on the existing cursor walk" treatment as
 *     `folderId`/`origin` before it — folders have no version of their own
 *     to bump independently, they ride the document store's version.
 *
 * v4 -> v5: adds the `bookmarks` object store (keyPath `id`, plus a
 * non-unique `documentId` index so every bookmark belonging to one document
 * can be found — and cascade-deleted, see `deleteDocument` below — without a
 * full table scan). This is a NEW, wholly independent store: unlike every
 * migration above, it does not touch a single field on any existing
 * `documents`/`folders`/`meta` record — there is nothing to backfill,
 * because no bookmark rows exist yet in any pre-v5 install (the feature was
 * new). This is also why this migration is safe to prove correct with a
 * plain "does an old document survive the upgrade" check rather than a
 * cursor-walk-content diff: an ADD-A-STORE migration cannot corrupt data it
 * never touches.
 *
 * v5 -> v6: adds the `highlights` object store (keyPath `id`, plus a
 * non-unique `documentId` index, so a document's highlights can be loaded —
 * and cascade-deleted with it — without scanning the whole store). Another
 * ADD-A-STORE migration, with the same properties as v4 -> v5 above: it
 * touches no existing record, so it cannot corrupt data it never reads, and
 * "does an old document survive the upgrade" is enough to prove it.
 *
 * WHY v5 SURVIVES A ROLLED-BACK FEATURE. The bookmarks UI was reverted (see
 * the `bookmarks-and-scroll-jump` branch, where the whole feature is parked
 * for later), but this store and this version number deliberately stayed.
 * IndexedDB cannot downgrade: reverting to `DB_VERSION = 4` makes
 * `indexedDB.open(name, 4)` throw `VersionError` in every browser that has
 * already opened the shipped v5 database — which is every browser that
 * loaded the app while bookmarks were live. The app would then fail to read
 * ANY document, not just bookmarks. So the schema is append-only in
 * practice, and rolling a feature back means leaving its store behind,
 * unused. Nothing reads or writes it today; the cascade in `deleteDocument`
 * is kept so that rows created while the feature was live still can't
 * outlive their document. When bookmarks return, the store is already there
 * with the user's data intact.
 */
const DB_VERSION = 6
const DOC_STORE = 'documents'
const META_STORE = 'meta'
const FOLDER_STORE = 'folders'
const BOOKMARK_STORE = 'bookmarks'
const BOOKMARK_DOCUMENT_ID_INDEX = 'documentId'
const HIGHLIGHT_STORE = 'highlights'
const HIGHLIGHT_DOCUMENT_ID_INDEX = 'documentId'
const ACTIVE_ID_KEY = 'activeId'

interface MetaRow {
  key: string
  value: string
}

// --- Cross-tab broadcast ---------------------------------------------------
//
// Two tabs open on the same document store can otherwise silently destroy
// each other's work: tab B loads before tab A's write, edits from the stale
// snapshot, and its own write clobbers A's — with no signal to either tab.
// This channel tells other tabs "the store changed, refresh your list";
// `putDocument`'s compare-before-write below is what actually stops the
// clobber.
const BROADCAST_CHANNEL_NAME = 'markdown-editor:documents'

export type DocumentBroadcast =
  { type: 'put'; document: MarkdownDocument } | { type: 'delete'; id: string }

const broadcastChannel: BroadcastChannel | null =
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(BROADCAST_CHANNEL_NAME)

function broadcast(message: DocumentBroadcast): void {
  broadcastChannel?.postMessage(message)
}

/** Subscribe to writes/deletes made by other tabs. Returns an unsubscribe
 * function. A no-op subscription (immediately returning a no-op unsubscribe)
 * when `BroadcastChannel` isn't available in this environment. */
export function subscribeToDocumentBroadcasts(
  listener: (message: DocumentBroadcast) => void,
): () => void {
  if (broadcastChannel === null) return () => {}
  const handler = (event: MessageEvent<DocumentBroadcast>) => listener(event.data)
  broadcastChannel.addEventListener('message', handler)
  return () => broadcastChannel.removeEventListener('message', handler)
}

// Same shape as the document broadcast channel above, kept separate so a
// listener for one kind never has to filter out messages of the other.
const FOLDER_BROADCAST_CHANNEL_NAME = 'markdown-editor:folders'

export type FolderBroadcast = { type: 'put'; folder: Folder } | { type: 'delete'; id: string }

const folderBroadcastChannel: BroadcastChannel | null =
  typeof BroadcastChannel === 'undefined'
    ? null
    : new BroadcastChannel(FOLDER_BROADCAST_CHANNEL_NAME)

function broadcastFolder(message: FolderBroadcast): void {
  folderBroadcastChannel?.postMessage(message)
}

export function subscribeToFolderBroadcasts(
  listener: (message: FolderBroadcast) => void,
): () => void {
  if (folderBroadcastChannel === null) return () => {}
  const handler = (event: MessageEvent<FolderBroadcast>) => listener(event.data)
  folderBroadcastChannel.addEventListener('message', handler)
  return () => folderBroadcastChannel.removeEventListener('message', handler)
}

/**
 * Thrown when opening the database is blocked by another tab still holding
 * a connection open at an older version (`IDBOpenDBRequest.onblocked`). This
 * is distinct from every other open failure on purpose: the caller (see
 * `model/documents.ts`'s `loadFx`) must not fold it into the generic
 * "IndexedDB unavailable, running in-memory" state, which would silently
 * hide the real, recoverable cause (close the other tab) behind a message
 * that reads like permanent unavailability.
 */
export class DatabaseBlockedError extends Error {
  constructor() {
    super('IndexedDB open was blocked by another tab running an older version')
    this.name = 'DatabaseBlockedError'
  }
}

// Fired every time an open request reports `onblocked` — may fire more than
// once if the blocking tab doesn't close. Purely informational: the retry
// loop that actually recovers lives in `getDatabase` below.
type BlockedListener = () => void
const blockedListeners = new Set<BlockedListener>()

/** Subscribe to "database open is currently blocked by another tab"
 * notifications. Returns an unsubscribe function. */
export function subscribeToDatabaseBlocked(listener: BlockedListener): () => void {
  blockedListeners.add(listener)
  return () => blockedListeners.delete(listener)
}

function notifyBlocked(): void {
  blockedListeners.forEach((listener) => listener())
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || indexedDB === null) {
      reject(new Error('IndexedDB is not available in this environment'))
      return
    }

    let request: IDBOpenDBRequest
    try {
      // `indexedDB.open` itself throws in some locked-down privacy modes,
      // rather than firing `onerror` — guard the synchronous call too.
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
      return
    }

    // Real v1 -> v2 -> v3 migration. `event.oldVersion` is 0 for a
    // brand-new database (nothing to migrate — the cursor walk below just
    // iterates zero rows), 1 or 2 for an existing installation. Every
    // store-creation step stays guarded by `contains` so re-running this
    // against a partially-created database (a previous open that failed
    // mid-upgrade) is still safe.
    request.onupgradeneeded = (event) => {
      const db = request.result
      const tx = request.transaction
      const oldVersion = event.oldVersion

      if (!db.objectStoreNames.contains(DOC_STORE)) {
        db.createObjectStore(DOC_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains(FOLDER_STORE)) {
        db.createObjectStore(FOLDER_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(BOOKMARK_STORE)) {
        const bookmarkStore = db.createObjectStore(BOOKMARK_STORE, { keyPath: 'id' })
        bookmarkStore.createIndex(BOOKMARK_DOCUMENT_ID_INDEX, 'documentId', { unique: false })
      }
      if (!db.objectStoreNames.contains(HIGHLIGHT_STORE)) {
        const highlightStore = db.createObjectStore(HIGHLIGHT_STORE, { keyPath: 'id' })
        highlightStore.createIndex(HIGHLIGHT_DOCUMENT_ID_INDEX, 'documentId', { unique: false })
      }

      // Backfill new per-document fields on disk in a single cursor walk —
      // content, title, and both timestamps are left completely untouched,
      // only missing/outdated fields are added or reshaped. `tx` is the
      // versionchange transaction driving this whole upgrade; it's still
      // open here, so this walk is part of the same atomic upgrade as the
      // store creation above (either all of it lands, or none of it does).
      //
      // The walk runs whenever *any* field could be missing or stale
      // (`oldVersion < 4` covers the v1->v4, v2->v4, and v3->v4 jumps) and
      // backfills/reshapes whichever fields a given record actually needs: a
      // record created under v1 and opened for the first time under v4 gets
      // `folderId: null` (v2's field) and a brand-new `origin: null` (v3/v4's
      // field) in one pass; a record already migrated to v3 keeps its
      // existing `owner`/`repo`/`branch`/`path` but has its old `sha` field
      // dropped in favour of `syncedHash: null` (see the v3->v4 doc comment
      // above `DB_VERSION`).
      if (oldVersion < 4 && tx !== null) {
        const store = tx.objectStore(DOC_STORE)
        const cursorRequest = store.openCursor()
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result
          if (!cursor) return
          const record = cursor.value as Record<string, unknown>
          const patched = { ...record }
          let changed = false
          if (typeof patched.folderId === 'undefined') {
            patched.folderId = null
            changed = true
          }
          if (typeof patched.origin === 'undefined') {
            patched.origin = null
            changed = true
          } else if (patched.origin !== null && typeof patched.origin === 'object') {
            const origin = patched.origin as Record<string, unknown>
            if ('sha' in origin || !('syncedHash' in origin)) {
              const rest: Record<string, unknown> = { ...origin }
              delete rest.sha
              patched.origin = { ...rest, syncedHash: null }
              changed = true
            }
          }
          if (changed) {
            cursor.update(patched)
          }
          cursor.continue()
        }
      }

      // Folders have no version field of their own — they ride the document
      // store's. Same walk shape as above: every existing folder record gets
      // an explicit `syncDirPath: null` if it doesn't already have one.
      if (oldVersion < 4 && oldVersion > 0 && tx !== null) {
        const folderStore = tx.objectStore(FOLDER_STORE)
        const folderCursorRequest = folderStore.openCursor()
        folderCursorRequest.onsuccess = () => {
          const cursor = folderCursorRequest.result
          if (!cursor) return
          const record = cursor.value as Record<string, unknown>
          if (typeof record.syncDirPath === 'undefined') {
            cursor.update({ ...record, syncDirPath: null })
          }
          cursor.continue()
        }
      }
    }
    // `onblocked` fires while another tab still holds an older connection
    // open. The moment that tab closes, this same pending request still
    // resolves/upgrades normally with no further action needed — so
    // `onblocked` doesn't reject by itself; it only notifies listeners
    // (see `subscribeToDatabaseBlocked` above) so the UI can show a
    // visible "waiting on another tab" state instead of looking hung.
    //
    // The grace-period timeout that actually gives up is deliberately
    // NOT started from inside `onblocked` — observed in testing: with
    // more than one version-change request already queued against the
    // same database, a later request can sit unresolved without its own
    // `onblocked` ever firing (it's waiting behind the earlier request,
    // not yet at the point where the browser checks for blocking
    // connections). Gating the timeout on `onblocked` in that situation
    // would mean this open() hangs forever with zero feedback and no
    // fallback — strictly worse than the generic "unavailable, run
    // in-memory" path this whole mechanism exists to avoid folding into.
    // Starting the timer unconditionally as soon as the request is issued
    // closes that gap: the open either resolves normally well within the
    // grace period (the overwhelmingly common case), or this gives up and
    // reports it as blocked regardless of whether `onblocked` happened to
    // fire.
    const BLOCKED_GRACE_MS = 5000
    let gaveUpAfterBlock = false

    const blockedTimeoutId = setTimeout(() => {
      gaveUpAfterBlock = true
      reject(new DatabaseBlockedError())
    }, BLOCKED_GRACE_MS)

    request.onsuccess = () => {
      clearTimeout(blockedTimeoutId)
      const database = request.result
      if (gaveUpAfterBlock) {
        // Already told the caller this attempt failed and moved on (see
        // the timeout above) — nobody holds a reference to this
        // connection, so close it immediately rather than let it linger
        // as a phantom blocker for the *next* open attempt.
        database.close()
        return
      }
      // If another tab later tries to open a newer version, this
      // connection would otherwise block it forever (the user would have
      // to know to close this tab). Close proactively and drop the cached
      // promise so this tab's next database call re-opens (picking up the
      // new version, or itself becoming the blocked party if it's the one
      // that's now stale) instead of operating on a connection that's
      // about to be superseded.
      database.onversionchange = () => {
        database.close()
        dbPromise = null
      }
      resolve(database)
    }
    request.onerror = () => {
      clearTimeout(blockedTimeoutId)
      if (!gaveUpAfterBlock) reject(request.error ?? new Error('Failed to open IndexedDB'))
    }
    // Still wired for the common case: fires promptly and gives listeners
    // (the UI banner) earlier feedback than waiting for the full grace
    // period to elapse. Doesn't itself start or stop the timeout above.
    request.onblocked = () => notifyBlocked()
  })
}

function getDatabase(): Promise<IDBDatabase> {
  if (dbPromise === null) {
    dbPromise = openDatabase().catch((error: unknown) => {
      // Drop the cached rejection so a later call can retry (e.g. the user
      // leaves private mode, or a transient quota issue clears). A cached
      // rejected promise would otherwise keep every future save failing.
      dbPromise = null
      throw error
    })
  }
  return dbPromise
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}

/** Returns a well-formed `GitHubOrigin` only when the raw value is an object
 * with `owner`, `repo`, `branch`, and `path` all present as non-empty
 * strings, and `syncedHash` present as either `null` or a non-empty string;
 * otherwise `null` (no origin). Same "drop anything malformed or
 * future-shaped rather than throw" philosophy as every other field in
 * `normalizeDocument` — a document with a broken origin is treated as
 * unassigned, never surfaced with a half-populated origin. */
function normalizeOrigin(value: unknown): GitHubOrigin | null {
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

/** Normalizes one raw `getAll()` entry into a well-formed `MarkdownDocument`,
 * repairing missing/malformed non-identifying fields with safe defaults and
 * dropping (returning `null` for) records that don't even have a usable
 * `id` — a corrupt or future-shaped record must never flow into the model
 * unchecked. */
function normalizeDocument(value: unknown): MarkdownDocument | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || raw.id === '') return null
  const now = Date.now()
  return {
    id: raw.id,
    title: typeof raw.title === 'string' ? raw.title : 'Untitled',
    content: typeof raw.content === 'string' ? raw.content : '',
    createdAt:
      typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : now,
    updatedAt:
      typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : now,
    // A record with no `folderId` at all predates the v2 migration and
    // should already have been backfilled to `null` by `onupgradeneeded`
    // — this default is the second line of defense, same spirit as every
    // other field here. A non-string, non-null value is treated as root
    // too, rather than trusting a corrupt/future-shaped value through.
    folderId: typeof raw.folderId === 'string' ? raw.folderId : null,
    // A record with no `origin` predates the v3 migration and should
    // already have been backfilled to `null` by `onupgradeneeded` — this is
    // the second line of defense. Anything not matching the full origin
    // shape (partial, malformed, future-shaped) is treated as local-only.
    origin: normalizeOrigin(raw.origin),
  }
}

export async function getAllDocuments(): Promise<MarkdownDocument[]> {
  const db = await getDatabase()
  const tx = db.transaction(DOC_STORE, 'readonly')
  const request = tx.objectStore(DOC_STORE).getAll()
  const raw = (await requestToPromise(request)) as unknown[]
  return raw.reduce<MarkdownDocument[]>((docs, entry) => {
    const normalized = normalizeDocument(entry)
    if (normalized !== null) docs.push(normalized)
    return docs
  }, [])
}

export interface PutResult {
  id: string
  /** The `updatedAt` actually on disk once this call returns — `doc.updatedAt`
   * if the write went through, or the pre-existing record's `updatedAt` if it
   * was refused as stale. Lets the caller reconcile its own bookkeeping with
   * reality either way. */
  diskUpdatedAt: number
}

/**
 * `base` is the on-disk `updatedAt` this write's edit was made *against*, as
 * last confirmed by the calling tab (see `$knownDiskUpdatedAt` in the model —
 * deliberately never advanced by another tab's broadcast, which is what
 * makes it a genuine staleness check rather than something a same-content
 * broadcast could sidestep). If the record actually on disk is newer than
 * `base`, another tab persisted a version this write never saw, and writing
 * anyway would silently erase it — so the write is refused instead.
 */
export async function putDocument(doc: MarkdownDocument, base: number): Promise<PutResult> {
  const db = await getDatabase()
  const tx = db.transaction(DOC_STORE, 'readwrite')
  const store = tx.objectStore(DOC_STORE)
  const existing = (await requestToPromise(
    store.get(doc.id) as IDBRequest<MarkdownDocument | undefined>,
  )) as MarkdownDocument | undefined
  const shouldWrite = existing === undefined || existing.updatedAt <= base
  if (shouldWrite) {
    store.put(doc)
  }
  await transactionDone(tx)
  if (shouldWrite) {
    broadcast({ type: 'put', document: doc })
  }
  return {
    id: doc.id,
    diskUpdatedAt: shouldWrite ? doc.updatedAt : (existing?.updatedAt ?? doc.updatedAt),
  }
}

/** Deletes every row in `store` whose `documentId` index matches `id`,
 * within an already-open transaction. Shared by the two per-document
 * satellite stores rather than written twice. */
function deleteByDocumentId(
  tx: IDBTransaction,
  storeName: string,
  indexName: string,
  id: string,
): Promise<void> {
  const index = tx.objectStore(storeName).index(indexName)
  return new Promise<void>((resolve, reject) => {
    const cursorRequest = index.openCursor(IDBKeyRange.only(id))
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result
      if (!cursor) {
        resolve()
        return
      }
      cursor.delete()
      cursor.continue()
    }
    cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error('Cursor walk failed'))
  })
}

/**
 * Deletes the document AND everything that belongs to it — its highlights,
 * and any bookmark rows left over from that parked feature — in ONE
 * `readwrite` transaction spanning all three stores. Same atomicity
 * reasoning as `deleteFolderAndOrphanDocuments` below: either the document
 * and all its satellites are gone, or (on any failure) none of it is, so
 * there is never an intermediate state where a row survives pointing at a
 * `documentId` that no longer resolves to anything. Enforced at the storage
 * layer rather than left to the in-memory model to remember.
 */
export async function deleteDocument(id: string): Promise<void> {
  const db = await getDatabase()
  const tx = db.transaction([DOC_STORE, BOOKMARK_STORE, HIGHLIGHT_STORE], 'readwrite')
  tx.objectStore(DOC_STORE).delete(id)
  await deleteByDocumentId(tx, BOOKMARK_STORE, BOOKMARK_DOCUMENT_ID_INDEX, id)
  await deleteByDocumentId(tx, HIGHLIGHT_STORE, HIGHLIGHT_DOCUMENT_ID_INDEX, id)
  await transactionDone(tx)
  broadcast({ type: 'delete', id })
}

// --- Highlights ------------------------------------------------------------

/** Same shape/defensiveness as `normalizeDocument`/`normalizeFolder` — a
 * corrupt or future-shaped record is dropped rather than flowing into the
 * model, and every non-identifying field is repaired with a safe default
 * rather than trusted.
 *
 * `id` and `documentId` must both be present: a highlight with no document
 * to belong to is meaningless, and `documentId` doubles as the index key
 * `deleteDocument`'s cascade and `getHighlightsForDocument` rely on, so a
 * malformed one has to be caught here rather than surfacing later as a
 * cursor lookup that silently finds nothing.
 *
 * A range that is reversed or empty is dropped rather than clamped. Those
 * are not "slightly wrong" values that a default can rescue — they mean the
 * record no longer describes a span of text, and rendering a zero-width
 * highlight would put an invisible, unclickable entry in the panel. */
function normalizeHighlight(value: unknown): Highlight | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || raw.id === '') return null
  if (typeof raw.documentId !== 'string' || raw.documentId === '') return null
  if (typeof raw.from !== 'number' || !Number.isFinite(raw.from) || raw.from < 0) return null
  if (typeof raw.to !== 'number' || !Number.isFinite(raw.to) || raw.to <= raw.from) return null
  return {
    id: raw.id,
    documentId: raw.documentId,
    from: raw.from,
    to: raw.to,
    color: isHighlightColorId(raw.color) ? raw.color : DEFAULT_HIGHLIGHT_COLOR,
    note: typeof raw.note === 'string' ? raw.note : '',
    text: typeof raw.text === 'string' ? raw.text : '',
    createdAt:
      typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt)
        ? raw.createdAt
        : Date.now(),
  }
}

/** Every highlight belonging to one document, via the `documentId` index —
 * not a full-store scan, so a workspace with thousands of highlights across
 * many documents still opens one document at constant-ish cost. */
export async function getHighlightsForDocument(documentId: string): Promise<Highlight[]> {
  const db = await getDatabase()
  const tx = db.transaction(HIGHLIGHT_STORE, 'readonly')
  const index = tx.objectStore(HIGHLIGHT_STORE).index(HIGHLIGHT_DOCUMENT_ID_INDEX)
  const raw = (await requestToPromise(index.getAll(IDBKeyRange.only(documentId)))) as unknown[]
  return raw.reduce<Highlight[]>((highlights, entry) => {
    const normalized = normalizeHighlight(entry)
    if (normalized !== null) highlights.push(normalized)
    return highlights
  }, [])
}

/** Unconditional upsert — like `putFolder`, a highlight write (create,
 * recolour, edit note, or a range remap after an edit) has no in-flight-edit
 * window for a second tab to race against in a way that would silently lose
 * data. "Whichever write lands last wins" is an acceptable rule for metadata
 * this low-stakes, and much simpler than `putDocument`'s compare-before-
 * write. */
export async function putHighlight(highlight: Highlight): Promise<void> {
  const db = await getDatabase()
  const tx = db.transaction(HIGHLIGHT_STORE, 'readwrite')
  tx.objectStore(HIGHLIGHT_STORE).put(highlight)
  await transactionDone(tx)
}

/** Batched counterpart for the range-remap flow: one document edit can move
 * every highlight after the caret, so this writes them in a single
 * transaction rather than N. */
export async function putHighlights(highlights: readonly Highlight[]): Promise<void> {
  if (highlights.length === 0) return
  const db = await getDatabase()
  const tx = db.transaction(HIGHLIGHT_STORE, 'readwrite')
  const store = tx.objectStore(HIGHLIGHT_STORE)
  for (const highlight of highlights) store.put(highlight)
  await transactionDone(tx)
}

export async function deleteHighlight(id: string): Promise<void> {
  const db = await getDatabase()
  const tx = db.transaction(HIGHLIGHT_STORE, 'readwrite')
  tx.objectStore(HIGHLIGHT_STORE).delete(id)
  await transactionDone(tx)
}

/** Used by the range-remap flow when an edit deletes a highlight's text
 * outright — several can vanish in one keystroke (select a paragraph, type
 * over it), so they go in one transaction. */
export async function deleteHighlights(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return
  const db = await getDatabase()
  const tx = db.transaction(HIGHLIGHT_STORE, 'readwrite')
  const store = tx.objectStore(HIGHLIGHT_STORE)
  for (const id of ids) store.delete(id)
  await transactionDone(tx)
}

export async function getActiveId(): Promise<string | null> {
  const db = await getDatabase()
  const tx = db.transaction(META_STORE, 'readonly')
  const request = tx.objectStore(META_STORE).get(ACTIVE_ID_KEY) as IDBRequest<MetaRow | undefined>
  const row = await requestToPromise(request)
  return row?.value ?? null
}

export async function setActiveId(id: string): Promise<void> {
  const db = await getDatabase()
  const tx = db.transaction(META_STORE, 'readwrite')
  tx.objectStore(META_STORE).put({ key: ACTIVE_ID_KEY, value: id } satisfies MetaRow)
  await transactionDone(tx)
}

// --- Folders ---------------------------------------------------------------

/** Same shape/defensiveness as `normalizeDocument` above — a corrupt or
 * future-shaped record is dropped rather than flowing into the model. */
function normalizeFolder(value: unknown): Folder | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || raw.id === '') return null
  const now = Date.now()
  return {
    id: raw.id,
    name: typeof raw.name === 'string' ? raw.name : 'Untitled folder',
    createdAt:
      typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : now,
    // A record with no `syncDirPath` predates the v4 migration and should
    // already have been backfilled to `null` by `onupgradeneeded` — this is
    // the second line of defense, same spirit as `normalizeOrigin` above.
    syncDirPath: typeof raw.syncDirPath === 'string' ? raw.syncDirPath : null,
  }
}

export async function getAllFolders(): Promise<Folder[]> {
  const db = await getDatabase()
  const tx = db.transaction(FOLDER_STORE, 'readonly')
  const request = tx.objectStore(FOLDER_STORE).getAll()
  const raw = (await requestToPromise(request)) as unknown[]
  return raw.reduce<Folder[]>((folders, entry) => {
    const normalized = normalizeFolder(entry)
    if (normalized !== null) folders.push(normalized)
    return folders
  }, [])
}

/** Unconditional upsert — unlike `putDocument`, folder writes are never
 * debounced/autosaved (create and rename both commit immediately, once),
 * so there's no in-flight-edit staleness window that needs a `base` guard
 * here. */
export async function putFolder(folder: Folder): Promise<void> {
  const db = await getDatabase()
  const tx = db.transaction(FOLDER_STORE, 'readwrite')
  tx.objectStore(FOLDER_STORE).put(folder)
  await transactionDone(tx)
  broadcastFolder({ type: 'put', folder })
}

/**
 * Deletes a folder and moves every document inside it back to root
 * (`folderId: null`) — deleting a folder must never delete the documents in
 * it. Both the folder deletion and every affected document's update happen
 * inside a single readwrite transaction spanning both stores, so this is
 * atomic: either the folder is gone and every one of its documents is
 * updated to root, or (on any failure) neither happens — there's no
 * intermediate state where a document is left pointing at a `folderId` that
 * no longer resolves to anything.
 *
 * Running this as one real transaction (rather than a read-then-write pair
 * of separate calls) also closes the "stale write recreates a deleted
 * folder" hazard at the storage layer: because a readwrite transaction
 * touching `FOLDER_STORE` here serializes against any other pending
 * readwrite transaction on the same store (e.g. `putFolder` from an
 * in-flight rename), whichever of the two actually lands last is the one
 * that determines the final on-disk state — never a lost update silently
 * merged from both.
 */
export async function deleteFolderAndOrphanDocuments(
  folderId: string,
): Promise<MarkdownDocument[]> {
  const db = await getDatabase()
  const tx = db.transaction([DOC_STORE, FOLDER_STORE], 'readwrite')
  const docStore = tx.objectStore(DOC_STORE)
  const orphaned: MarkdownDocument[] = []

  await new Promise<void>((resolve, reject) => {
    const cursorRequest = docStore.openCursor()
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result
      if (!cursor) {
        resolve()
        return
      }
      const normalized = normalizeDocument(cursor.value)
      if (normalized !== null && normalized.folderId === folderId) {
        const moved: MarkdownDocument = { ...normalized, folderId: null }
        cursor.update(moved)
        orphaned.push(moved)
      }
      cursor.continue()
    }
    cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error('Cursor walk failed'))
  })

  tx.objectStore(FOLDER_STORE).delete(folderId)
  await transactionDone(tx)

  orphaned.forEach((doc) => broadcast({ type: 'put', document: doc }))
  broadcastFolder({ type: 'delete', id: folderId })

  return orphaned
}

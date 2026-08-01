import type { MarkdownDocument } from '../model/types'

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
const DB_VERSION = 1
const DOC_STORE = 'documents'
const META_STORE = 'meta'
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

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(DOC_STORE)) {
        db.createObjectStore(DOC_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'))
    request.onblocked = () => reject(new Error('IndexedDB open was blocked'))
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

export async function deleteDocument(id: string): Promise<void> {
  const db = await getDatabase()
  const tx = db.transaction(DOC_STORE, 'readwrite')
  tx.objectStore(DOC_STORE).delete(id)
  await transactionDone(tx)
  broadcast({ type: 'delete', id })
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

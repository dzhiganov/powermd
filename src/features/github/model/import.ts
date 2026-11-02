import { createEffect, createEvent, createStore, sample } from 'effector'

import { toastRequested } from '@/shared/lib/toast'
import type { GitHubOrigin } from '@/features/documents'

import { getTree, getFileContent, GitHubAuthError } from '../lib/api'
import { importRetryDelayMs } from '../lib/backoff'
import { sha256Hex } from '../lib/hash'
import type { SyncConfig } from '../lib/config'
import { clearImportDone, isImportDone, storeImportDone } from '../lib/importState'
import {
  $connectionStatus,
  $syncConnection,
  callWithToken,
  disconnectRequested,
  syncConnected,
} from './connection'
import { $documentsSnapshot, documentsSnapshotChanged } from './snapshot'

/**
 * First-connect import: the moment a repo connection is finalized (see
 * `connection.ts`'s `syncConnected`), every markdown file already in the
 * repo (under the configured subfolder) that isn't already linked to a
 * local document becomes a brand-new one — see `documentsBulkImported` in
 * `@/features/documents` for how it's turned into real documents/folders.
 * "Already linked" is checked against `$documentsSnapshot`'s current
 * origins, which is what makes this safe to fire again on a reconnect
 * without duplicating anything: a document imported on a previous connect
 * still carries the exact `owner`/`repo`/`branch`/`path` it was imported
 * with, so it's recognized and skipped.
 */

function isMarkdownPath(path: string): boolean {
  const lower = path.toLowerCase()
  return lower.endsWith('.md') || lower.endsWith('.markdown')
}

/** Same rule as the old per-file GitHub flow's `fileOpen.ts` used for a
 * document's title: strip a trailing `.ext`. */
function stripExtension(filename: string): string {
  const index = filename.lastIndexOf('.')
  return index <= 0 ? filename : filename.slice(0, index)
}

export interface BulkImportDoc {
  title: string
  content: string
  /** The repo directory (relative to the subfolder root, possibly
   * multi-segment) this file lived in, or `null` for the subfolder root
   * itself — see `@/features/documents`' `documentsBulkImported` for how
   * this becomes a (possibly newly-created) folder. */
  dirPath: string | null
  origin: GitHubOrigin
}

interface ImportParams {
  config: SyncConfig
  docs: { origin: GitHubOrigin | null }[]
  /** Resuming an import that did not finish, rather than a fresh connect. */
  resume: boolean
}

interface ImportResult {
  imported: BulkImportDoc[]
  /** `getTree`'s own `truncated` flag — GitHub caps a single recursive tree
   * response, so an unusually large repo can come back with an incomplete
   * file listing. Surfaced as a toast (see below) rather than silently
   * importing a partial set with no indication anything was missed. */
  truncated: boolean
  /** Files that could not be read (too large, rate limited, …). Skipped
   * rather than failing the whole import: one bad file must not hold every
   * new document back forever. They stay on GitHub untouched — the push
   * never writes over a file it has not read (`planPathMoves`). */
  skipped: string[]
}

// The whole body runs inside `callWithToken` (`./connection.ts`) — a 401 on
// ANY request in this sequence (the tree read, or any one file's content
// fetch) aborts the sequence, gets one refresh-and-retry of the WHOLE
// import against a fresh token, and re-lists the tree from scratch rather
// than trying to resume mid-file-list.
//
// Run under a Web Lock: two tabs resuming the same unfinished import at once
// would each create a copy of every file. The second tab waits, then finds
// the import finished and does nothing.
const IMPORT_LOCK_NAME = 'markdown-editor:github-import'

function withImportLock<T>(task: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || navigator.locks === undefined) return task()
  return navigator.locks.request(IMPORT_LOCK_NAME, task)
}

const importFx = createEffect(({ config, docs, resume }: ImportParams): Promise<ImportResult> =>
  withImportLock(async () => {
    if (resume && isImportDone(config)) return { imported: [], truncated: false, skipped: [] }
    const result = await runImport(config, docs)
    // Recorded before the lock is released, so a tab waiting on it sees it.
    storeImportDone(config)
    return result
  }),
)

function runImport(
  config: SyncConfig,
  docs: { origin: GitHubOrigin | null }[],
): Promise<ImportResult> {
  return callWithToken(async (token) => {
    const { entries, truncated } = await getTree(token, config.owner, config.repo, config.branch)
    const prefix = config.subfolder === '' ? '' : `${config.subfolder}/`
    const markdownEntries = entries.filter(
      (entry) =>
        entry.type === 'blob' && isMarkdownPath(entry.path) && entry.path.startsWith(prefix),
    )

    // Only a document that has actually been pushed to a path is that
    // file's local copy. A local document merely *assigned* a path — which
    // happens the moment the connection forms, before this import has even
    // listed the tree — has never seen the remote file; counting it as
    // linked skipped importing an existing `notes.md` and let the next push
    // overwrite it with an unrelated local "Notes". The local document is
    // given another path instead (`planPathMoves`).
    const alreadyLinkedPaths = new Set(
      docs
        .map((doc) => doc.origin)
        .filter(
          (origin): origin is GitHubOrigin =>
            origin !== null &&
            origin.syncedHash !== null &&
            origin.owner === config.owner &&
            origin.repo === config.repo &&
            origin.branch === config.branch,
        )
        .map((origin) => origin.path),
    )

    const toImport = markdownEntries.filter((entry) => !alreadyLinkedPaths.has(entry.path))

    const imported: BulkImportDoc[] = []
    const skipped: string[] = []
    for (const entry of toImport) {
      // Sequential, not `Promise.all` — a repo with hundreds of markdown
      // files would otherwise fire hundreds of concurrent requests at once
      // and blow through the rate limit immediately. A file that cannot be
      // read is skipped and reported (see `ImportResult.skipped`); only an
      // expired token aborts, so `callWithToken` can refresh and retry.
      let fetched
      try {
        fetched = await getFileContent(token, config.owner, config.repo, entry.path, config.branch)
      } catch (error) {
        if (error instanceof GitHubAuthError) throw error
        skipped.push(entry.path)
        continue
      }
      const content = fetched.content
      const relPath = entry.path.slice(prefix.length)
      const slashIndex = relPath.lastIndexOf('/')
      const dirPath = slashIndex === -1 ? null : relPath.slice(0, slashIndex)
      const filename = slashIndex === -1 ? relPath : relPath.slice(slashIndex + 1)
      const hash = await sha256Hex(content)
      imported.push({
        title: stripExtension(filename),
        content,
        dirPath,
        origin: {
          owner: config.owner,
          repo: config.repo,
          branch: config.branch,
          path: entry.path,
          syncedHash: hash,
        },
      })
    }
    return { imported, truncated, skipped }
  })
}

/** Output: the batch of documents to create — `src/app/wiring.ts` samples
 * this into `@/features/documents`' `documentsBulkImported`. */
export const importCompleted = createEvent<BulkImportDoc[]>()
sample({ clock: importFx.doneData, fn: (result) => result.imported, target: importCompleted })

// A truncated tree means the import may have missed files past GitHub's
// single-response cap — not an error (what *was* found still imports fine),
// but worth a visible, specific heads-up rather than a silently incomplete
// import.
sample({
  clock: importFx.doneData,
  filter: (result) => result.truncated,
  fn: (): { text: string; tone: 'warning' } => ({
    text: 'This repository is large — the first-connect import may have missed some files past GitHub’s listing limit.',
    tone: 'warning',
  }),
  target: toastRequested,
})

/** Files the last import could not read — shown in the sync panel, and
 * once as a toast. */
export const $importSkipped = createStore<string[]>([])
  .on(importFx.doneData, (_, result) => result.skipped)
  .reset(syncConnected, disconnectRequested)

sample({
  clock: importFx.doneData,
  filter: (result) => result.skipped.length > 0,
  fn: ({ skipped }): { text: string; tone: 'warning' } => ({
    text: `Could not import ${skipped.length === 1 ? 'one file' : `${skipped.length} files`} from GitHub (${skipped.join(', ')}). ${skipped.length === 1 ? 'It stays' : 'They stay'} on GitHub untouched.`,
    tone: 'warning',
  }),
  target: toastRequested,
})

export const $importPending = importFx.pending

export const $importError = createStore<string | null>(null)
  .on(importFx.fail, (_, { error }) =>
    error instanceof Error ? error.message : 'Could not import from GitHub.',
  )
  .on(importFx.done, () => null)

sample({
  clock: importFx.fail,
  fn: ({ error }): { text: string; tone: 'error' } => ({
    text: error instanceof Error ? error.message : 'Could not import from GitHub.',
    tone: 'error',
  }),
  target: toastRequested,
})

// Runs on every fresh "Connect" — `syncConnected` only ever fires from the
// wizard's explicit `connectSubmitted`, never from `$syncConnection` being
// seeded off persisted storage on an ordinary reload (see `connection.ts`'s
// doc comment on `$syncConnection`). An import that did not finish is resumed
// further down instead.
sample({
  clock: syncConnected,
  source: $documentsSnapshot,
  fn: (docs, config): ImportParams => ({ config, docs, resume: false }),
  target: importFx,
})

// --- Finished, or still owed -------------------------------------------------

/** Whether the import has finished for the active connection — persisted
 * (`lib/importState.ts`). `model/sync.ts` pushes no never-pushed document
 * until it is true. */
export const $importDone = createStore(isImportDone($syncConnection.getState()))
  .on(importFx.done, () => true)
  .on(syncConnected, () => false)
  .reset(disconnectRequested)

const storeImportDoneFx = createEffect((config: SyncConfig) => storeImportDone(config))
const clearImportDoneFx = createEffect(() => clearImportDone())
sample({ clock: importFx.done, fn: ({ params }) => params.config, target: storeImportDoneFx })
sample({ clock: [syncConnected, disconnectRequested], target: clearImportDoneFx })

function hasPushedDocument(docs: { origin: GitHubOrigin | null }[], config: SyncConfig): boolean {
  return docs.some(
    ({ origin }) =>
      origin !== null &&
      origin.syncedHash !== null &&
      origin.owner === config.owner &&
      origin.repo === config.repo &&
      origin.branch === config.branch,
  )
}

/**
 * A connection made by a version that did not record the import has no
 * flag, though its import ran long ago. If this browser has pushed to it,
 * that is the case: marking it done, rather than importing again, keeps
 * every file whose document was deleted here from coming back as a new
 * document. Only for the connection restored at startup — a fresh connect
 * always imports.
 */
const $legacyConnection = createStore(
  $syncConnection.getState() !== null && !$importDone.getState(),
).reset(syncConnected, disconnectRequested)

const legacyImportRecognized = createEvent<SyncConfig>()
sample({
  clock: documentsSnapshotChanged,
  source: { legacy: $legacyConnection, config: $syncConnection, done: $importDone },
  filter: ({ legacy, config, done }, docs) =>
    legacy && config !== null && !done && hasPushedDocument(docs, config),
  fn: ({ config }) => config as SyncConfig,
  target: legacyImportRecognized,
})
$importDone.on(legacyImportRecognized, () => true)
sample({ clock: legacyImportRecognized, target: storeImportDoneFx })

/** Asks for an import that is still owed to be run again — fired by
 * `model/sync.ts` on every sync attempt, so a failed import is retried
 * whenever a sync would run. */
export const importResumeRequested = createEvent()

const $snapshotLoaded = createStore(false).on(documentsSnapshotChanged, () => true)

// Back off between retries of an import that keeps failing (the tree can't
// be listed: GitHub down, the repository gone), rather than listing it again
// on every sync. `retryAt` is 0 when nothing is being waited for.
const importRetryWaitFx = createEffect(
  (at: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, Math.max(0, at - Date.now()))
    }),
)
const $importBackoff = createStore({ failures: 0, retryAt: 0 })
  .on(importFx.fail, ({ failures }) => ({
    failures: failures + 1,
    retryAt: Date.now() + importRetryDelayMs(failures + 1),
  }))
  // The wait for the latest failure is over. Cleared here rather than
  // compared with the clock: a timer can fire a millisecond early.
  .on(importRetryWaitFx.done, (state, { params }) =>
    state.retryAt === params ? { ...state, retryAt: 0 } : state,
  )
  .reset(importFx.done, syncConnected, disconnectRequested)
const $importRetryAt = $importBackoff.map((state) => state.retryAt)

// Try again by itself once the wait is over, not only on the next sync.
sample({
  clock: $importRetryAt,
  filter: (at) => at > 0,
  target: importRetryWaitFx,
})

// Resume an import that never finished: once a token works and the local
// documents are loaded (importing against an empty list would duplicate
// every file already linked to one), and again on every sync attempt.
sample({
  clock: [importResumeRequested, $connectionStatus, $snapshotLoaded, importRetryWaitFx.done],
  source: {
    config: $syncConnection,
    docs: $documentsSnapshot,
    done: $importDone,
    pending: importFx.pending,
    loaded: $snapshotLoaded,
    status: $connectionStatus,
    legacy: $legacyConnection,
    retryAt: $importRetryAt,
  },
  filter: ({ config, docs, done, pending, loaded, status, legacy, retryAt }) =>
    config !== null &&
    !done &&
    !pending &&
    retryAt === 0 &&
    loaded &&
    status === 'connected' &&
    !(legacy && hasPushedDocument(docs, config)),
  fn: ({ config, docs }): ImportParams => ({ config: config as SyncConfig, docs, resume: true }),
  target: importFx,
})

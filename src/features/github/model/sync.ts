import { combine, createEffect, createEvent, createStore, sample } from 'effector'
import { debounce } from 'patronum'

import { toastRequested } from '@/shared/lib/toast'
import type { GitHubOrigin } from '@/features/documents'

import {
  getBranchRef,
  getCommit,
  createBlob,
  createTree,
  createCommit,
  createFileViaContents,
  updateRef,
  GitHubRateLimitError,
  GitHubRefConflictError,
} from '../lib/api'
import { sha256Hex } from '../lib/hash'
import { assignPaths } from '../lib/pathAssignment'
import type { SyncConfig } from '../lib/config'
import { $syncConnection, syncConnected, disconnectRequested, getActiveToken } from './connection'
import {
  $documentsSnapshot,
  $foldersSnapshot,
  documentsSnapshotChanged,
  foldersSnapshotChanged,
  type SyncDocInput,
} from './snapshot'
import { importCompleted, $importPending, $importError } from './import'

// Re-exported so callers (the sync status UI, `$syncStatus` below) can get
// every piece of "is GitHub sync busy / in an error state right now" from
// this one module, without also having to import `./import` directly.
export { $importPending, $importError }

/**
 * The automatic one-way sync engine: the app is always the source of truth
 * (see `ARCHITECTURE.md`... actually see the feature-level design note this
 * whole feature was built from — edits made on github.com are never pulled
 * back and will be overwritten by the next push). Two phases:
 *
 * 1. **Path assignment** (this module's `assignmentComputed` flow) — pure,
 *    synchronous, no network: every document/folder still missing a sync
 *    slot for the active connection gets one, deterministically, via
 *    `lib/pathAssignment.ts`. Runs the instant the connection or the
 *    document/folder snapshot changes, and is idempotent (a document that
 *    already has a valid slot is left untouched), so re-running it after its
 *    own write-back round-trips back through `$documentsSnapshot` converges
 *    in one extra tick rather than looping.
 * 2. **Push** (`runSyncFx`) — batches every document whose content hash has
 *    diverged from its last-synced hash into ONE commit via the Git Data
 *    API (get the branch ref -> get its tree -> create blobs for changed
 *    docs only -> create a new tree with `base_tree` so untouched files are
 *    preserved -> create the commit -> move the ref). Debounced well past
 *    the editor's own autosave debounce (`AUTOSAVE_MS_MAX` in
 *    `features/settings`, 3000ms) so a burst of edits collapses into one
 *    commit, plus available on demand via `syncRequested` ("Sync now").
 *
 * Local deletion is never reflected here — there is no "delete" branch in
 * this module at all, deliberately: a document removed locally simply stops
 * appearing in future `$documentsSnapshot` values, and since nothing here
 * ever builds a tree deletion entry, its file on GitHub is left untouched.
 */

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error'

// --- Public events -----------------------------------------------------------

/** Manual "Sync now" — same debounce-bypassing shape as `documents`'
 * `saveRequested` (Mod-S). */
export const syncRequested = createEvent()

// --- Phase 1: path / directory assignment -----------------------------------

interface AssignmentOutcome {
  folderDirs: { id: string; dirPath: string }[]
  docPaths: { id: string; path: string }[]
}

const assignmentComputed = createEvent<AssignmentOutcome>()

sample({
  clock: [documentsSnapshotChanged, foldersSnapshotChanged, syncConnected],
  source: { docs: $documentsSnapshot, folders: $foldersSnapshot, connection: $syncConnection },
  fn: ({ docs, folders, connection }): AssignmentOutcome => {
    if (connection === null) return { folderDirs: [], docPaths: [] }
    return assignPaths(connection, folders, docs)
  },
  target: assignmentComputed,
})

/** Output: newly-assigned folder directories — `src/app/wiring.ts` samples
 * this into `@/features/documents`' `folderSyncDirPathsApplied`. */
export const folderDirsAssigned = createEvent<{ id: string; syncDirPath: string }[]>()
sample({
  clock: assignmentComputed,
  filter: (outcome) => outcome.folderDirs.length > 0,
  fn: (outcome) =>
    outcome.folderDirs.map((entry) => ({ id: entry.id, syncDirPath: entry.dirPath })),
  target: folderDirsAssigned,
})

/** Output: newly-assigned document sync paths (freshly assigned, so
 * `syncedHash` starts `null` — the next push picks them up as dirty) —
 * `src/app/wiring.ts` samples this into `@/features/documents`'
 * `documentGithubOriginsApplied`. */
export const originsAssigned = createEvent<{ id: string; origin: GitHubOrigin }[]>()
sample({
  clock: assignmentComputed,
  source: $syncConnection,
  filter: (connection, outcome) => connection !== null && outcome.docPaths.length > 0,
  fn: (connection, outcome): { id: string; origin: GitHubOrigin }[] => {
    const c = connection as SyncConfig
    return outcome.docPaths.map((entry) => ({
      id: entry.id,
      origin: {
        owner: c.owner,
        repo: c.repo,
        branch: c.branch,
        path: entry.path,
        syncedHash: null,
      },
    }))
  },
  target: originsAssigned,
})

/** Output: a push landed — `src/app/wiring.ts` samples this into
 * `@/features/documents`' `documentGithubOriginsApplied` too (same event,
 * different payload shape: this one carries a real `syncedHash`). */
export const pushCompleted = createEvent<{ id: string; origin: GitHubOrigin }[]>()

// --- Phase 2: push -----------------------------------------------------------

/** Debounced well past `features/settings`' `AUTOSAVE_MS_MAX` (3000ms) —
 * "editing has settled" has to mean settled across every open document, not
 * just faster than a single keystroke's own autosave. */
const SYNC_DEBOUNCE_MS = 5000

const snapshotSettled = createEvent()
sample({
  clock: [documentsSnapshotChanged, foldersSnapshotChanged],
  fn: () => undefined,
  target: snapshotSettled,
})
const autoSyncTick = debounce(snapshotSettled, SYNC_DEBOUNCE_MS)

const syncQueued = createEvent()
// `fn` here is only about discarding each clock's own payload (`importCompleted`
// carries the imported batch, the other two carry nothing) — `syncQueued`
// itself is a plain trigger, not a data carrier.
sample({
  clock: [autoSyncTick, syncRequested, importCompleted],
  fn: () => undefined,
  target: syncQueued,
})

function originMatchesConnection(origin: GitHubOrigin | null, connection: SyncConfig): boolean {
  return (
    origin !== null &&
    origin.owner === connection.owner &&
    origin.repo === connection.repo &&
    origin.branch === connection.branch
  )
}

function basename(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? path : path.slice(index + 1)
}

interface DirtyDoc {
  doc: SyncDocInput
  hash: string
}

function commitMessageFor(dirty: DirtyDoc[]): string {
  if (dirty.length === 1) {
    return `Sync ${basename((dirty[0].doc.origin as GitHubOrigin).path)}`
  }
  return `Sync ${dirty.length} documents`
}

const MAX_PUSH_ATTEMPTS = 4

/** Refetches the branch ref/base tree and builds+commits a fresh tree on top
 * of it, then moves the ref. On a non-fast-forward rejection (the ref moved
 * since this attempt started, i.e. a concurrent writer), refetches and
 * retries from scratch against the new base — never force-pushes — up to
 * `MAX_PUSH_ATTEMPTS` times.
 *
 * A repository with no commits is handled first and separately: see the
 * bootstrap branch below, which is also what makes this recursive. */
async function pushBatch(
  token: string,
  connection: SyncConfig,
  dirty: DirtyDoc[],
  attempt = 1,
): Promise<{ id: string; origin: GitHubOrigin }[]> {
  const { owner, repo, branch } = connection
  const ref = await getBranchRef(token, owner, repo, branch)

  if (ref === null) {
    // A repository with zero commits cannot be pushed to with the git data
    // endpoints at all: GitHub rejects `POST /git/blobs` with 409 "Git
    // Repository is empty." until a first commit exists, so there is nothing
    // for a tree to be built from. Bootstrap with a single Contents write —
    // which does work against an empty repository — and then recurse, at
    // which point the ref exists and the normal batched path takes over for
    // whatever is left.
    const [first, ...rest] = dirty
    const firstOrigin = first.doc.origin as GitHubOrigin
    await createFileViaContents(
      token,
      owner,
      repo,
      branch,
      firstOrigin.path,
      first.doc.content,
      commitMessageFor([first]),
    )
    const bootstrapped = { id: first.doc.id, origin: { ...firstOrigin, syncedHash: first.hash } }
    if (rest.length === 0) return [bootstrapped]
    return [bootstrapped, ...(await pushBatch(token, connection, rest, attempt))]
  }

  const baseTreeSha = (await getCommit(token, owner, repo, ref.sha)).treeSha

  const blobs = await Promise.all(
    dirty.map(async ({ doc }) => ({
      path: (doc.origin as GitHubOrigin).path,
      sha: (await createBlob(token, owner, repo, doc.content)).sha,
    })),
  )
  const tree = await createTree(token, owner, repo, baseTreeSha, blobs)
  const commit = await createCommit(token, owner, repo, commitMessageFor(dirty), tree.sha, [
    ref.sha,
  ])

  try {
    await updateRef(token, owner, repo, branch, commit.sha)
  } catch (error) {
    // The branch moved between this cycle's `getBranchRef` and this update —
    // a concurrent writer. Refetch and rebuild against the new base rather
    // than ever force-pushing over their commit.
    if (error instanceof GitHubRefConflictError && attempt < MAX_PUSH_ATTEMPTS) {
      return pushBatch(token, connection, dirty, attempt + 1)
    }
    throw error
  }

  return dirty.map(({ doc, hash }) => ({
    id: doc.id,
    origin: { ...(doc.origin as GitHubOrigin), syncedHash: hash },
  }))
}

interface RunSyncParams {
  connection: SyncConfig
  docs: SyncDocInput[]
}

const runSyncFx = createEffect(
  async ({ connection, docs }: RunSyncParams): Promise<{ id: string; origin: GitHubOrigin }[]> => {
    const token = getActiveToken()
    if (token === null) throw new Error('Not connected to GitHub.')

    // Only documents that already carry a valid origin *for this
    // connection* are push candidates — anything still missing one is
    // picked up by the very next sync cycle once Phase 1 (which runs
    // synchronously off every snapshot change, including the write-back
    // from this same cycle's own push) assigns it. In steady state this
    // filters out nothing; it only matters for the same-tick gap right
    // after a brand-new document is created or a connection first forms.
    const eligible = docs.filter((doc) => originMatchesConnection(doc.origin, connection))
    const withHashes = await Promise.all(
      eligible.map(async (doc) => ({ doc, hash: await sha256Hex(doc.content) })),
    )
    const dirty = withHashes.filter(
      ({ doc, hash }) => (doc.origin as GitHubOrigin).syncedHash !== hash,
    )

    if (dirty.length === 0) return []
    return pushBatch(token, connection, dirty)
  },
)

sample({ clock: runSyncFx.doneData, target: pushCompleted })

// --- Trigger gating: never overlap a run, never hammer while rate-limited --
//
// If a trigger arrives while a push is already in flight, it's remembered
// (`$rerunQueued`) rather than dropped or queued as a second concurrent
// call — the moment the in-flight run settles, one fresh run starts against
// whatever the snapshot looks like *then* (not the stale snapshot from when
// the trigger fired), which is exactly the content a rerun should push.
const $rerunQueued = createStore(false)
  .on(syncQueued, () => true)
  .on(runSyncFx, () => false)
  .reset(disconnectRequested)

/** Set from a `GitHubRateLimitError`'s `resetAt` on failure, cleared on the
 * next success or on any other kind of failure. Gates both automatic and
 * manual sync attempts — "do not hammer" applies to a deliberate retry click
 * just as much as to the debounce, since a rate limit doesn't care which
 * triggered the request that would exceed it. */
export const $rateLimitedUntil = createStore<Date | null>(null)
  .on(runSyncFx.fail, (_, { error }) =>
    error instanceof GitHubRateLimitError ? error.resetAt : null,
  )
  .on(runSyncFx.done, () => null)
  .reset(disconnectRequested)

function canRunNow(connection: SyncConfig | null, rateLimitedUntil: Date | null): boolean {
  if (connection === null) return false
  if (rateLimitedUntil === null) return true
  return Date.now() >= rateLimitedUntil.getTime()
}

sample({
  clock: syncQueued,
  source: {
    connection: $syncConnection,
    docs: $documentsSnapshot,
    pending: runSyncFx.pending,
    rateLimitedUntil: $rateLimitedUntil,
  },
  filter: ({ connection, pending, rateLimitedUntil }) =>
    !pending && canRunNow(connection, rateLimitedUntil),
  fn: ({ connection, docs }): RunSyncParams => ({ connection: connection as SyncConfig, docs }),
  target: runSyncFx,
})

// A rerun queued while a push was in flight fires the instant that push
// settles, against the freshest snapshot.
sample({
  clock: [runSyncFx.done, runSyncFx.fail],
  source: {
    connection: $syncConnection,
    docs: $documentsSnapshot,
    queued: $rerunQueued,
    rateLimitedUntil: $rateLimitedUntil,
  },
  filter: ({ connection, queued, rateLimitedUntil }) =>
    queued && canRunNow(connection, rateLimitedUntil),
  fn: ({ connection, docs }): RunSyncParams => ({ connection: connection as SyncConfig, docs }),
  target: runSyncFx,
})

// Once a rate limit clears, automatically try the queued work rather than
// leaving it stranded until the next unrelated edit — a single one-shot
// timer per rate-limit window, not a poll.
const rateLimitWaitFx = createEffect(
  (resetAt: Date): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, Math.max(0, resetAt.getTime() - Date.now()))
    }),
)
sample({
  clock: $rateLimitedUntil,
  filter: (resetAt): resetAt is Date => resetAt !== null,
  target: rateLimitWaitFx,
})
sample({ clock: rateLimitWaitFx.done, fn: () => undefined, target: syncQueued })

// --- Status ------------------------------------------------------------------
//
// Derived, not reduced — same "can never disagree with reality" shape as
// `documents`' `$saveStatus`: busy while either the import or a push is in
// flight, `error` while the most recent attempt of either failed (and stays
// that way — persistent and actionable, never auto-hidden, per this
// feature's error-surfacing rule; only a fresh success or a disconnect
// clears it), `synced` once connected with nothing in flight and no
// standing error, `idle` before a connection exists at all.

function describeSyncError(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not sync to GitHub.'
}

export const $syncError = createStore<string | null>(null)
  .on(runSyncFx.fail, (_, { error }) => describeSyncError(error))
  .on(runSyncFx.done, () => null)
  .reset(disconnectRequested)

export const $lastSyncAt = createStore<number | null>(null)
  .on(runSyncFx.done, () => Date.now())
  .reset(disconnectRequested)

export const $syncStatus = combine(
  $syncConnection,
  runSyncFx.pending,
  $importPending,
  $syncError,
  $importError,
  (connection, pushPending, importPending, syncError, importError): SyncStatus => {
    if (connection === null) return 'idle'
    if (pushPending || importPending) return 'syncing'
    if (syncError !== null || importError !== null) return 'error'
    return 'synced'
  },
)

sample({
  clock: runSyncFx.fail,
  fn: ({ error }): { text: string; tone: 'error' } => ({
    text: describeSyncError(error),
    tone: 'error',
  }),
  target: toastRequested,
})

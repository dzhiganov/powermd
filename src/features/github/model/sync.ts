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
import { decideSyncSchedule } from '../lib/schedule'
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
 *    preserved -> create the commit -> move the ref). Triggered at most once
 *    per a user-configurable interval (default 5 minutes, `$autoSyncIntervalMs`
 *    below) rather than after every pause in editing — writers pause
 *    constantly, and syncing on every pause turns the GitHub history into
 *    hundreds-of-commits-a-day noise. See `../lib/schedule.ts`'s
 *    `decideSyncSchedule` (pure, unit tested there) for the actual
 *    scheduling rule and the "Automatic sync scheduling" section below for
 *    the wiring around it. Also available on demand via `syncRequested`
 *    ("Sync now"), which bypasses the interval entirely.
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
//
// The scheduling trigger for this phase (`syncQueued`, and everything that
// decides when it fires) lives further down, right after `runSyncFx` itself
// — see the "Automatic sync scheduling" section below. It needs
// `runSyncFx.done` and (indirectly, inside a function body) `$lastSyncAt`,
// both declared later in this file, so it's grouped there instead of here.

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

/**
 * The commit this client last put on the branch, or `null` before the first
 * push of a session.
 *
 * A ref read immediately after a write can still return the previous tip —
 * GitHub's own propagation, not the HTTP cache, which requests already opt
 * out of. A push queued right behind a successful one therefore builds on a
 * parent that has already been superseded, and is rejected as not a fast
 * forward. Preferring the commit we just made removes the dependency on that
 * read entirely for consecutive pushes from this client.
 *
 * Trusting it is safe: `updateRef` is never forced, so if another writer has
 * genuinely moved the branch, the update is rejected and the retry refetches.
 * The worst case is one wasted attempt, not a clobbered commit.
 */
let lastPushedCommitSha: string | null = null

function forgetLastPushedCommit(): void {
  lastPushedCommitSha = null
}

// Forgotten on disconnect and on every (re)connect: a sha remembered from one
// repository or branch means nothing in another, and trusting it there would
// build on a commit that does not exist in the new history.
disconnectRequested.watch(forgetLastPushedCommit)
syncConnected.watch(forgetLastPushedCommit)

const MAX_PUSH_ATTEMPTS = 4

/** Multiplied by the attempt number, so retries wait ~0.5s, 1s, 1.5s rather
 * than all firing inside the same tick against an unchanged ref. */
const RETRY_BACKOFF_MS = 500

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

  // Prefer the commit this client last made over a ref read that may not have
  // caught up with it yet (see `lastPushedCommitSha`). If that commit can no
  // longer be fetched — a different repo, a force push, a deleted branch —
  // fall back to whatever the ref actually says.
  let baseSha = ref.sha
  let baseTreeSha: string
  if (lastPushedCommitSha !== null && lastPushedCommitSha !== ref.sha) {
    try {
      baseTreeSha = (await getCommit(token, owner, repo, lastPushedCommitSha)).treeSha
      baseSha = lastPushedCommitSha
    } catch {
      baseTreeSha = (await getCommit(token, owner, repo, ref.sha)).treeSha
      lastPushedCommitSha = null
    }
  } else {
    baseTreeSha = (await getCommit(token, owner, repo, ref.sha)).treeSha
  }

  const blobs = await Promise.all(
    dirty.map(async ({ doc }) => ({
      path: (doc.origin as GitHubOrigin).path,
      sha: (await createBlob(token, owner, repo, doc.content)).sha,
    })),
  )
  const tree = await createTree(token, owner, repo, baseTreeSha, blobs)
  const commit = await createCommit(token, owner, repo, commitMessageFor(dirty), tree.sha, [
    baseSha,
  ])

  try {
    await updateRef(token, owner, repo, branch, commit.sha)
    lastPushedCommitSha = commit.sha
  } catch (error) {
    // The branch moved between this cycle's `getBranchRef` and this update —
    // a concurrent writer. Refetch and rebuild against the new base rather
    // than ever force-pushing over their commit.
    if (error instanceof GitHubRefConflictError && attempt < MAX_PUSH_ATTEMPTS) {
      // Back off before rebuilding. A ref read immediately after a write can
      // still return the previous tip, so retrying with no delay just rebuilds
      // on the same stale base and fails identically — the retries burn out
      // in milliseconds without ever seeing the commit that was just made.
      await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS * attempt))
      return pushBatch(token, connection, dirty, attempt + 1)
    }
    // A non-fast-forward that survives every retry is not a passing race, so
    // report the identities involved rather than the status alone. The tip
    // this attempt built on, the commit it produced, and that commit's parent
    // are the three values that distinguish "the branch really moved" from
    // "the ref we read was never the tip" — indistinguishable otherwise.
    if (error instanceof GitHubRefConflictError) {
      throw new GitHubRefConflictError(
        `${error.message} (read tip ${ref.sha.slice(0, 8)}, built commit ` +
          `${commit.sha.slice(0, 8)} on parent ${ref.sha.slice(0, 8)}, ` +
          `after ${attempt} attempt(s))`,
      )
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

// --- Automatic sync scheduling ----------------------------------------------
//
// At most one automatic push per `$autoSyncIntervalMs`. `decideSyncSchedule`
// (`../lib/schedule.ts`) makes the actual decision as a pure function of
// "now" plus a handful of inputs; everything here just executes whatever it
// returns and feeds its own state back in on the next call.

/** How often local edits should reach GitHub, in ms. Defaulted to match
 * `features/settings`' own default (5 minutes) before that feature's
 * persisted value is fed in via `src/app/wiring.ts`'s one-kick-then-sample
 * (same shape as `documents`' `$autosaveIntervalMs`/`autosaveIntervalChanged`
 * — settings owns the persisted preference, this feature keeps its own live
 * mirror). */
const DEFAULT_AUTO_SYNC_INTERVAL_MS = 5 * 60_000
export const autoSyncIntervalChanged = createEvent<number>()
const $autoSyncIntervalMs = createStore<number>(DEFAULT_AUTO_SYNC_INTERVAL_MS).on(
  autoSyncIntervalChanged,
  (_, ms) => ms,
)

const snapshotSettled = createEvent()
sample({
  clock: [documentsSnapshotChanged, foldersSnapshotChanged],
  fn: () => undefined,
  target: snapshotSettled,
})

/**
 * A coarse "something changed since the last successful sync" flag — NOT a
 * hash-diff (that stays exactly where it already was, inside `runSyncFx`
 * above, which is what actually decides what gets pushed). This only
 * decides *whether/when to attempt* a sync at all, so erring toward "still
 * dirty" costs at most one sync attempt that resolves to nothing to push; it
 * can never cause a real edit to be skipped. True the instant a snapshot
 * changes — including the very first snapshot at startup (`documentsSnapshotChanged`'s
 * `sample` in `src/app/wiring.ts` fires off `$documentList`'s own updates,
 * load included), which is what makes dirty documents from a previous
 * session sync promptly on the next launch rather than waiting a full
 * interval: `$lastSyncAt` below is session-local and starts `null`, so
 * `decideSyncSchedule` treats that first snapshot exactly like "the interval
 * has already elapsed." Cleared once a sync actually completes.
 */
const $dirtySinceLastSync = createStore(false)
  .on(snapshotSettled, () => true)
  .on(runSyncFx.done, () => false)
  .reset(disconnectRequested)

/** A short settle window — same purpose the old, always-applied
 * `SYNC_DEBOUNCE_MS` served for every sync: once `decideSyncSchedule` says
 * "sync now" (the interval has already elapsed, or nothing has ever synced
 * this session), still wait for a burst of edits to go quiet before actually
 * syncing, so it collapses into one push rather than one per edit. Never
 * used for the "schedule at a fixed future time" branch below — that
 * deadline is fixed the moment it's first computed and must NOT keep
 * sliding forward on every further edit, which is exactly what a debounce
 * would do to it. */
const SETTLE_DEBOUNCE_MS = 5000

const settleArmed = createEvent()
const settleElapsed = debounce(settleArmed, SETTLE_DEBOUNCE_MS)

/**
 * The one piece of mutable scheduling state `decideSyncSchedule` needs
 * beyond what's already in stores: the absolute time (epoch ms) a
 * `schedule-at` timer is currently armed for, or `null`. Plain module state
 * plus a real `setTimeout`/`clearTimeout` rather than an Effector primitive
 * — same precedent as `lastPushedCommitSha` above — because the deadline
 * this represents must stay FIXED once armed (only ever replaced by an
 * earlier one, e.g. the interval setting shrinking — see
 * `decideSyncSchedule`'s own doc comment), which patronum's `debounce`
 * (resets its own deadline on every call) can't express.
 */
let pendingTimerAt: number | null = null
let pendingTimeoutId: ReturnType<typeof setTimeout> | null = null

function clearPendingTimer(): void {
  if (pendingTimeoutId !== null) clearTimeout(pendingTimeoutId)
  pendingTimeoutId = null
  pendingTimerAt = null
}

const intervalElapsed = createEvent()

function armIntervalTimer(at: number): void {
  clearPendingTimer()
  pendingTimerAt = at
  pendingTimeoutId = setTimeout(
    () => {
      pendingTimeoutId = null
      pendingTimerAt = null
      intervalElapsed()
    },
    Math.max(0, at - Date.now()),
  )
}

function runScheduleDecision(): void {
  const decision = decideSyncSchedule({
    now: Date.now(),
    lastSyncAt: $lastSyncAt.getState(),
    intervalMs: $autoSyncIntervalMs.getState(),
    hasDirty: $dirtySinceLastSync.getState(),
    pendingTimerAt,
  })
  if (decision.kind === 'sync-now') settleArmed()
  else if (decision.kind === 'schedule-at') armIntervalTimer(decision.at)
  // 'nothing': the correct timer (or none, if nothing is dirty) is already
  // in place — no action needed.
}

// Re-run the decision on every snapshot change...
snapshotSettled.watch(runScheduleDecision)
// ...and whenever the interval setting itself changes, so shortening it
// reschedules sooner rather than waiting for the next edit to notice. Guards
// on `$dirtySinceLastSync` because this watcher also fires once,
// synchronously, the moment `.watch` is called (Effector stores replay their
// current value immediately) — at that point in module evaluation nothing
// has ever been marked dirty yet, so this is a no-op at startup, not a
// premature schedule.
$autoSyncIntervalMs.watch(() => {
  if ($dirtySinceLastSync.getState()) runScheduleDecision()
})

// Once a push actually starts (settle-triggered, interval-triggered,
// manual, or a queued rerun — see `runSyncFx` in the trigger-gating section
// below), any `schedule-at` timer still armed is stale: `$lastSyncAt` is
// about to move, which changes what the correct next due time even is — so
// it's cleared here rather than left to fire later against now-outdated
// inputs. (The `intervalElapsed` timer clears itself identically the moment
// it fires — see `armIntervalTimer` above — so this is a no-op in that
// specific case and only actually does something for the other three
// triggers.)
runSyncFx.watch(clearPendingTimer)
disconnectRequested.watch(clearPendingTimer)

const syncQueued = createEvent()
// `fn` here is only about discarding each clock's own payload
// (`importCompleted` carries the imported batch, the others carry nothing)
// — `syncQueued` itself is a plain trigger, not a data carrier.
// `importCompleted` and `syncRequested` both deliberately bypass
// `decideSyncSchedule` entirely: first-connect import and manual "Sync now"
// are meant to run immediately, interval or no interval.
sample({
  clock: [settleElapsed, intervalElapsed, syncRequested, importCompleted],
  fn: () => undefined,
  target: syncQueued,
})

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

// --- Offline recovery ---------------------------------------------------
//
// A push made while offline fails at the network layer inside
// `githubRequest` (`GitHubNetworkError` — "Could not reach GitHub. Check
// your connection and try again.") and lands here as a normal `$syncError`,
// exactly like any other failed push: visible, not silently swallowed, and
// not spun forever waiting on a request that was never going to answer.
//
// What it does NOT do on its own is retry once connectivity comes back —
// nothing above re-queues a push just because the network recovered; the
// next attempt would otherwise wait on the next actual edit (or a manual
// "Sync now"), which could be an arbitrarily long time after the user is
// back online. The browser's own `online` event closes that gap: it fires
// once the network path is usable again, so re-queuing from it resumes the
// stalled push without the user having to do anything. Firing this
// unconditionally (not gated on `$syncError` being set) is still cheap and
// correct — `syncQueued`'s own consumer already no-ops when there's no
// connection, and a `runSyncFx` run with nothing dirty resolves immediately
// — so there's no real cost to also firing it after a network blip that
// never actually caused a failure.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => syncQueued())
}

// --- Flush before the tab disappears ----------------------------------------
//
// `visibilitychange` -> hidden (a tab switch, minimizing, switching apps)
// fires while the page is still fully alive — a multi-call Git Data push
// (ref -> tree -> blobs -> tree -> commit -> ref, see `pushBatch` above) can
// run to completion here exactly as it would from any other trigger, so
// this is a real, reliable flush point, not a best-effort one.
//
// `pagehide` (tab close, navigating away, refresh) is a different story:
// browsers give a page very little guaranteed time to run once this fires,
// and there is no way for this code to know in advance whether several
// sequential `fetch` calls will get to finish. This listener still attempts
// it — best-effort, same spirit as `features/documents`' own
// `flushPendingToIndexedDB` on `pagehide` — but that's honestly all it is:
// it will often be aborted mid-flight and never reach GitHub. That's an
// accepted gap, not a bug, because IndexedDB already has every edit locally
// (`features/documents`' own autosave, entirely independent of this
// feature) regardless of whether this push completes — the worst case is
// that this session's edits reach GitHub on the *next* session's sync
// instead of this one.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && $dirtySinceLastSync.getState()) syncQueued()
  })
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if ($dirtySinceLastSync.getState()) syncQueued()
  })
}

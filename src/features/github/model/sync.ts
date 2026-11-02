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
  getTree,
  updateRef,
  GitHubRateLimitError,
  GitHubRefConflictError,
} from '../lib/api'
import { sha256Hex } from '../lib/hash'
import { assignPaths, planPathMoves } from '../lib/pathAssignment'
import { decideSyncSchedule } from '../lib/schedule'
import { computeBackoffDelayMs, MAX_PUSH_ATTEMPTS } from '../lib/backoff'
import {
  clearStoredLastPushedCommit,
  getStoredLastPushedCommit,
  storeLastPushedCommit,
} from '../lib/lastPushedCommit'
import type { SyncConfig } from '../lib/config'
import {
  $connectionStatus,
  $syncConnection,
  callWithToken,
  disconnectRequested,
  syncConnected,
  type ConnectionStatus,
} from './connection'
import {
  $documentsSnapshot,
  $foldersSnapshot,
  documentsSnapshotChanged,
  foldersSnapshotChanged,
  type SyncDocInput,
  type SyncFolderInput,
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
 * Local deletion is never reflected here, deliberately: a document removed
 * locally simply stops appearing in future `$documentsSnapshot` values, and
 * its file on GitHub is left untouched. The only file this module ever
 * removes is a renamed or re-foldered document's own previous file, in the
 * same commit that writes it under its new name (`planPathMoves`).
 */

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error'

// --- Public events -----------------------------------------------------------

/** Manual "Sync now" — same debounce-bypassing shape as `documents`'
 * `saveRequested` (Mod-S). */
export const syncRequested = createEvent()

// --- Phase 1: path / directory assignment -----------------------------------

interface AssignmentOutcome {
  folderDirs: { id: string; dirPath: string }[]
  /** New paths, plus `placedAs` recorded for origins that lack it. */
  origins: { id: string; origin: GitHubOrigin }[]
}

function computeAssignment(
  connection: SyncConfig,
  docs: SyncDocInput[],
  folders: SyncFolderInput[],
): AssignmentOutcome {
  const { folderDirs, docPaths } = assignPaths(connection, folders, docs)
  const byId = new Map(docs.map((doc) => [doc.id, doc]))
  const origins: { id: string; origin: GitHubOrigin }[] = docPaths.map(({ id, path }) => {
    const doc = byId.get(id) as SyncDocInput
    return {
      id,
      origin: {
        owner: connection.owner,
        repo: connection.repo,
        branch: connection.branch,
        path,
        syncedHash: null,
        placedAs: { title: doc.title, folderId: doc.folderId },
      },
    }
  })
  // An origin written by an older version has no record of the title and
  // folder its path was named after. Recording the current ones — rather
  // than treating the path as stale — is what keeps every untouched file
  // where it is; only a rename made from now on moves anything.
  for (const doc of docs) {
    if (!originMatchesConnection(doc.origin, connection)) continue
    const origin = doc.origin as GitHubOrigin
    if (origin.placedAs != null) continue
    origins.push({
      id: doc.id,
      origin: { ...origin, placedAs: { title: doc.title, folderId: doc.folderId } },
    })
  }
  return { folderDirs, origins }
}

const assignmentComputed = createEvent<AssignmentOutcome>()

sample({
  clock: [documentsSnapshotChanged, foldersSnapshotChanged, syncConnected],
  source: { docs: $documentsSnapshot, folders: $foldersSnapshot, connection: $syncConnection },
  fn: ({ docs, folders, connection }): AssignmentOutcome =>
    connection === null
      ? { folderDirs: [], origins: [] }
      : computeAssignment(connection, docs, folders),
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
 * `syncedHash` starts `null` — the next push picks them up as dirty), and
 * `placedAs` recorded on older origins — `src/app/wiring.ts` samples this
 * into `@/features/documents`' `documentGithubOriginsApplied`. */
export const originsAssigned = createEvent<{ id: string; origin: GitHubOrigin }[]>()
sample({
  clock: assignmentComputed,
  filter: (outcome) => outcome.origins.length > 0,
  fn: (outcome) => outcome.origins,
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

interface DirtyDoc {
  doc: SyncDocInput
  hash: string
  /** Where the content goes — the document's current path, or a new one
   * when it was renamed or moved (see `planPathMoves`). */
  path: string
  /** The document's own file to remove in the same commit when it moves,
   * else `null`. */
  removePath: string | null
}

function toSyncedOrigin({ doc, hash, path }: DirtyDoc): { id: string; origin: GitHubOrigin } {
  const origin = doc.origin as GitHubOrigin
  // A move records the title and folder the new path was named after. A
  // document that did not move keeps its old record: its move may only have
  // been deferred (its folder unknown in this tab, say), and overwriting the
  // record would lose it.
  const placedAs =
    path === origin.path ? origin.placedAs : { title: doc.title, folderId: doc.folderId }
  return { id: doc.id, origin: { ...origin, path, syncedHash: hash, placedAs } }
}

// The full repo path, not just the file name: `untitled.md` alone does not
// say which of several directories' `untitled.md` changed.
function commitMessageFor(dirty: DirtyDoc[]): string {
  if (dirty.length === 1) {
    const [{ path, removePath }] = dirty
    return removePath === null ? `Sync ${path}` : `Rename ${removePath} to ${path}`
  }
  return `Sync ${dirty.length} documents`
}

/**
 * The commit this client last put on the branch, or `null` before the first
 * push of this connection (a fresh connection, or nothing yet successfully
 * pushed since the last reload — see `lib/lastPushedCommit.ts`, which is
 * where this is actually persisted; this module never keeps its own
 * in-memory copy, so every read/write below goes straight to storage and
 * survives a reload or PWA restart).
 *
 * A ref read immediately after a write can still return the previous tip —
 * GitHub's own propagation, not the HTTP cache, which requests already opt
 * out of. A push queued right behind a successful one therefore builds on a
 * parent that has already been superseded, and is rejected as not a fast
 * forward. Preferring the commit we just made removes the dependency on that
 * read entirely for consecutive pushes from this client — reload included,
 * which is exactly when it used to be forgotten right when it was most
 * needed (a reload right after an `updateRef` that landed on GitHub but
 * whose response never made it back).
 *
 * Trusting it is safe: `updateRef` is never forced, so if another writer has
 * genuinely moved the branch, the update is rejected and the retry refetches.
 * The worst case is one wasted attempt, not a clobbered commit.
 */
function forgetLastPushedCommit(): void {
  clearStoredLastPushedCommit()
}

// Forgotten on disconnect and on every (re)connect: a sha remembered from one
// repository or branch means nothing in another, and trusting it there would
// build on a commit that does not exist in the new history. Belt-and-braces
// alongside `lib/lastPushedCommit.ts`'s own owner/repo/branch scoping check
// on every read — either alone already prevents cross-connection reuse.
disconnectRequested.watch(forgetLastPushedCommit)
syncConnected.watch(forgetLastPushedCommit)

/** `pushBatch` throws this when it discovers, after waiting out a backoff
 * delay, that the connection it was pushing to no longer exists (a
 * disconnect) or has been replaced by a different repo/branch (a fresh
 * `syncConnected`) — see the abort check in the `GitHubRefConflictError`
 * catch branch below. Deliberately distinct from every other failure this
 * module can throw: `runSyncFx.fail`'s consumers (the error toast and
 * `$syncError`) special-case it below to stay silent, since a disconnect the
 * user just asked for is not a sync failure worth reporting as one, and
 * `$dirtySinceLastSync`/`$lastSyncAt` are `.on(runSyncFx.done, …)`-only
 * (untouched by `.fail`), so a document that was never actually pushed stays
 * correctly marked dirty for the next attempt. */
export class SyncAbortedError extends Error {
  constructor() {
    super('Sync stopped: the connection changed before this retry completed.')
    this.name = 'SyncAbortedError'
  }
}

/** `pushBatch` throws this instead of `GitHubRefConflictError` when every
 * retry is exhausted AND a fresh re-read of the branch tip, taken right
 * after the last rejection, comes back identical to the tip that final
 * attempt was built on — i.e. GitHub's own reported tip never actually
 * moved, so nothing outraced this client; the read (or the write's own
 * visibility) simply hadn't caught up yet within the retry window. That is
 * propagation lag, not a lost or conflicting edit, and the message says so
 * explicitly rather than reusing `GitHubRefConflictError`'s "identities
 * involved" wording, which implies a real concurrent writer. The next
 * scheduled sync (or "Sync now") retries automatically — nothing here
 * changes `$dirtySinceLastSync`, so the documents involved stay queued. */
export class GitHubSyncLagError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitHubSyncLagError'
  }
}

function sameConnectionTarget(a: SyncConfig, b: SyncConfig | null): boolean {
  return b !== null && a.owner === b.owner && a.repo === b.repo && a.branch === b.branch
}

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
    // Nothing exists yet, so there is nothing for a move to remove.
    const [first, ...rest] = dirty.map((entry) => ({ ...entry, removePath: null }))
    await createFileViaContents(
      token,
      owner,
      repo,
      branch,
      first.path,
      first.doc.content,
      commitMessageFor([first]),
    )
    const bootstrapped = toSyncedOrigin(first)
    if (rest.length === 0) return [bootstrapped]
    return [bootstrapped, ...(await pushBatch(token, connection, rest, attempt))]
  }

  // Prefer the commit this client last made over a ref read that may not have
  // caught up with it yet (see the doc comment on `forgetLastPushedCommit`
  // above). Persisted (`lib/lastPushedCommit.ts`), scoped to this exact
  // owner/repo/branch, and re-read here on every attempt rather than cached
  // in a local variable, so a value written by an earlier attempt in this
  // same retry loop is picked up too. If that commit can no longer be
  // fetched — a different repo, a force push, a deleted branch — fall back
  // to whatever the ref actually says.
  const rememberedSha = getStoredLastPushedCommit(owner, repo, branch)
  let baseSha = ref.sha
  let baseTreeSha: string
  if (rememberedSha !== null && rememberedSha !== ref.sha) {
    try {
      baseTreeSha = (await getCommit(token, owner, repo, rememberedSha)).treeSha
      baseSha = rememberedSha
    } catch {
      baseTreeSha = (await getCommit(token, owner, repo, ref.sha)).treeSha
      forgetLastPushedCommit()
    }
  } else {
    baseTreeSha = (await getCommit(token, owner, repo, ref.sha)).treeSha
  }

  const blobs = await Promise.all(
    dirty.map(async ({ doc, path }) => ({
      path,
      sha: (await createBlob(token, owner, repo, doc.content)).sha,
    })),
  )
  // A move removes the document's old file — only if it is still there:
  // GitHub rejects the whole tree over a removal of a path that does not
  // exist (someone already deleted or moved it on github.com).
  const removePaths = dirty.flatMap(({ removePath }) => (removePath === null ? [] : [removePath]))
  let removals: { path: string; sha: null }[] = []
  if (removePaths.length > 0) {
    const { entries } = await getTree(token, owner, repo, baseTreeSha)
    const existing = new Set(entries.map((entry) => entry.path))
    removals = removePaths.filter((path) => existing.has(path)).map((path) => ({ path, sha: null }))
  }
  const tree = await createTree(token, owner, repo, baseTreeSha, [...blobs, ...removals])
  // GitHub already has exactly this content — another tab of this app pushed
  // it first, or an earlier push landed but its response was lost. A commit
  // here would change nothing and only add an empty entry to the history.
  // Only when the base is the branch tip itself: a base taken from the
  // remembered commit says nothing about what the branch holds now (it may
  // have been reset past it), so the push still has to go through.
  if (tree.sha === baseTreeSha && baseSha === ref.sha) {
    return dirty.map(toSyncedOrigin)
  }
  const commit = await createCommit(token, owner, repo, commitMessageFor(dirty), tree.sha, [
    baseSha,
  ])

  try {
    await updateRef(token, owner, repo, branch, commit.sha)
    storeLastPushedCommit(owner, repo, branch, commit.sha)
  } catch (error) {
    // Built on the remembered commit rather than the ref read, and rejected:
    // the remembered commit is not on the branch's history any more — the
    // branch moved past it (an edit on github.com, another device, a push
    // whose response never arrived) — so it can never be built on again.
    // Forgotten here, or every retry and every later sync would rebuild on it
    // and be rejected identically, forever.
    if (error instanceof GitHubRefConflictError && baseSha !== ref.sha) {
      forgetLastPushedCommit()
    }
    // The branch moved between this cycle's `getBranchRef` and this update —
    // a concurrent writer, OR (the common real-world case this retry loop
    // was built for) GitHub's own read replicas simply hadn't caught up with
    // an earlier write yet. Refetch and rebuild against the new base rather
    // than ever force-pushing over anyone's commit.
    if (error instanceof GitHubRefConflictError && attempt < MAX_PUSH_ATTEMPTS) {
      // Exponential backoff with jitter (`lib/backoff.ts`) — a ref read
      // immediately after a write can still return the previous tip for
      // several seconds, so retrying with too short a delay just rebuilds on
      // the same stale base and fails identically every time, burning out
      // every attempt before GitHub's replicas ever catch up. This is a
      // background sync with no user waiting on it, so a total window of
      // ~30s+ across every attempt is cheap insurance.
      await new Promise((resolve) => setTimeout(resolve, computeBackoffDelayMs(attempt)))

      // The wait above can take several seconds, easily long enough for the
      // user to disconnect (or reconnect to a different repo/branch) while
      // this retry loop is mid-backoff. Check before rebuilding+retrying —
      // and, critically, before ever calling `updateRef` again — so a torn-
      // down connection can't have this loop keep pushing to it (or to
      // whatever replaced it) after the fact. `$syncConnection` (not just
      // `disconnectRequested`) is checked so a reconnect-to-a-different-target
      // mid-backoff is caught the same way a plain disconnect is.
      if (!sameConnectionTarget(connection, $syncConnection.getState())) {
        throw new SyncAbortedError()
      }
      return pushBatch(token, connection, dirty, attempt + 1)
    }
    // A non-fast-forward that survives every retry is either a genuine
    // concurrent writer or propagation lag that never resolved within the
    // retry window — indistinguishable from the rejection alone, but not
    // from a fresh read taken right now: if GitHub's tip has actually moved
    // past what this attempt built on, a writer really did race this one; if
    // it's still sitting at the exact same sha, nothing ever raced it, this
    // client's own read (or the write's visibility) was simply still
    // catching up. Best-effort — a failed re-read here just falls through to
    // the ordinary conflict message below, which is still accurate.
    if (error instanceof GitHubRefConflictError) {
      const freshRef = await getBranchRef(token, owner, repo, branch).catch(() => null)
      if (freshRef !== null && freshRef.sha === ref.sha) {
        throw new GitHubSyncLagError(
          `GitHub hasn't finished propagating an earlier push yet (the branch ` +
            `tip is still ${ref.sha.slice(0, 8)} after ${attempt} attempt(s) over ` +
            `~30s). Nothing was lost — your changes are still saved locally and ` +
            `this will sync automatically once GitHub catches up.`,
        )
      }
      // The tip this attempt built on, the commit it produced, and that
      // commit's parent are the three values that distinguish "the branch
      // really moved" from "the ref we read was never the tip" —
      // indistinguishable otherwise.
      throw new GitHubRefConflictError(
        `${error.message} (read tip ${ref.sha.slice(0, 8)}, built commit ` +
          `${commit.sha.slice(0, 8)} on parent ${ref.sha.slice(0, 8)}, ` +
          `after ${attempt} attempt(s))`,
      )
    }
    throw error
  }

  return dirty.map(toSyncedOrigin)
}

interface RunSyncParams {
  connection: SyncConfig
  docs: SyncDocInput[]
  folders: SyncFolderInput[]
}

const runSyncFx = createEffect(
  async ({
    connection,
    docs,
    folders,
  }: RunSyncParams): Promise<{ id: string; origin: GitHubOrigin }[]> => {
    // Only documents that already carry a valid origin *for this
    // connection* are push candidates — anything still missing one is
    // picked up by the very next sync cycle once Phase 1 (which runs
    // synchronously off every snapshot change, including the write-back
    // from this same cycle's own push) assigns it. In steady state this
    // filters out nothing; it only matters for the same-tick gap right
    // after a brand-new document is created or a connection first forms.
    const eligible = docs.filter((doc) => originMatchesConnection(doc.origin, connection))
    const moves = new Map(
      planPathMoves(connection, folders, eligible).map((move) => [move.id, move]),
    )
    const withHashes = await Promise.all(
      eligible.map(async (doc): Promise<DirtyDoc> => {
        const origin = doc.origin as GitHubOrigin
        const move = moves.get(doc.id)
        return {
          doc,
          hash: await sha256Hex(doc.content),
          path: move?.path ?? origin.path,
          removePath: move?.removeOld === true ? origin.path : null,
        }
      }),
    )
    const dirty = withHashes.filter(({ doc, hash, path }) => {
      const { syncedHash } = doc.origin as GitHubOrigin
      // A blank document that has never been pushed is a brand-new
      // "Untitled" one nobody has written in yet — pushing it would only
      // leave an empty file behind on GitHub. It goes up with its first real
      // content instead.
      if (syncedHash === null && doc.content.trim() === '') return false
      return syncedHash !== hash || path !== (doc.origin as GitHubOrigin).path
    })

    if (dirty.length === 0) return []
    // `callWithToken` (`./connection.ts`) gives the whole batch one
    // refresh-and-retry on a 401 before giving up — same contract as every
    // other network-calling effect in this feature.
    return callWithToken((token) => pushBatch(token, connection, dirty))
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
 * — same "plain module state, not a store" shape `pushBatch`'s retry
 * backoff above uses for its own wait — because the deadline
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

function canRunNow(
  connection: SyncConfig | null,
  rateLimitedUntil: Date | null,
  connectionStatus: ConnectionStatus,
  importPending: boolean,
): boolean {
  if (connection === null) return false
  // Pushing while the first-connect import is still reading the repository
  // could overwrite a file before it is imported. `importCompleted` queues a
  // sync of its own once the import is done.
  if (importPending) return false
  // A token that needs re-authentication cannot push — trying anyway would
  // just fail the same 401 (already-attempted refresh included) on every
  // interval tick until the user signs in again. `callWithToken` itself only
  // ever retries once per call; THIS is what stops the scheduler from
  // calling it again and again in the meantime.
  if (connectionStatus === 'reauth-required') return false
  if (rateLimitedUntil === null) return true
  return Date.now() >= rateLimitedUntil.getTime()
}

sample({
  clock: syncQueued,
  source: {
    connection: $syncConnection,
    docs: $documentsSnapshot,
    folders: $foldersSnapshot,
    pending: runSyncFx.pending,
    rateLimitedUntil: $rateLimitedUntil,
    connectionStatus: $connectionStatus,
    importPending: $importPending,
  },
  filter: ({ connection, pending, rateLimitedUntil, connectionStatus, importPending }) =>
    !pending && canRunNow(connection, rateLimitedUntil, connectionStatus, importPending),
  fn: ({ connection, docs, folders }): RunSyncParams => ({
    connection: connection as SyncConfig,
    docs,
    folders,
  }),
  target: runSyncFx,
})

// A rerun queued while a push was in flight fires the instant that push
// settles, against the freshest snapshot.
sample({
  clock: [runSyncFx.done, runSyncFx.fail],
  source: {
    connection: $syncConnection,
    docs: $documentsSnapshot,
    folders: $foldersSnapshot,
    queued: $rerunQueued,
    rateLimitedUntil: $rateLimitedUntil,
    connectionStatus: $connectionStatus,
    importPending: $importPending,
  },
  filter: ({ connection, queued, rateLimitedUntil, connectionStatus, importPending }) =>
    queued && canRunNow(connection, rateLimitedUntil, connectionStatus, importPending),
  fn: ({ connection, docs, folders }): RunSyncParams => ({
    connection: connection as SyncConfig,
    docs,
    folders,
  }),
  target: runSyncFx,
})

// Once the user signs in again after a `reauth-required` state (the same
// `tokenSubmitted` -> `validateTokenFx.done` path both the PAT form and the
// GitHub App callback go through — see `model/connection.ts` and
// `model/oauth.ts`) — immediately try any queued work rather than leaving it
// stranded until the next unrelated edit. Harmless before a sync connection
// has ever been chosen too: `canRunNow` above already no-ops on
// `connection === null`.
sample({
  clock: $connectionStatus,
  filter: (status) => status === 'connected',
  fn: () => undefined,
  target: syncQueued,
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
  .on(runSyncFx.fail, (state, { error }) =>
    // A `SyncAbortedError` means the retry loop stopped because the user
    // disconnected (or reconnected elsewhere) mid-backoff — not a sync
    // failure to report. `disconnectRequested` has already reset this store
    // to `null` by the time this late-arriving `.fail` lands anyway (see
    // `SyncAbortedError`'s own doc comment); leaving the state unchanged
    // here rather than writing a fresh (misleading, post-disconnect) message
    // over it is what keeps that true.
    error instanceof SyncAbortedError ? state : describeSyncError(error),
  )
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
  // A `SyncAbortedError` is expected, silent housekeeping (see its own doc
  // comment) — not something worth interrupting the user with a toast for,
  // especially since it fires right after they asked to disconnect.
  filter: ({ error }) => !(error instanceof SyncAbortedError),
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

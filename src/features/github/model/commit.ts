import { createEffect, createEvent, createStore, sample } from 'effector'

import { toastRequested } from '@/shared/lib/toast'
import type { GitHubOrigin } from '@/features/documents'

import { commitFile, getFileContent, GitHubConflictError } from '../lib/api'
import { disconnectRequested, getActiveToken } from './connection'

/**
 * Committing the active document back to GitHub, and resolving the three-way
 * conflict when the file changed on GitHub since it was opened.
 *
 * The active document's `{ id, content, origin }` is projected in from
 * `wiring.ts` (`documents` never imports `github`) via
 * `activeDocumentForCommitChanged`. On a successful commit, `commitSucceeded`
 * flows back out to `documents`' `documentGithubSynced` (new sha); the
 * reload-remote conflict choice flows out via `remoteReloadRequested` to
 * `documents`' `documentRemoteApplied`.
 */

export type CommitStatus = 'idle' | 'committing' | 'conflict' | 'error' | 'done'

/** The active document, projected down to just what a commit needs. */
interface ActiveCommitDoc {
  id: string
  content: string
  origin: GitHubOrigin
}

/** The snapshot actually being committed — kept so the conflict-resolution
 * choices can act on the same content/origin/message the write attempted,
 * even if the user keeps editing while the conflict dialog is open. `doc` is
 * deliberately non-null here: every producer below (see the "Flow" sections)
 * resolves a nullable candidate down to this type through a dedicated
 * narrowing `sample` (filter-as-type-guard, no `fn`) *before* anything is
 * built with this shape — see those samples' doc comments for why that split
 * is what makes the narrowing actually type-check, cast-free. */
interface CommitInput {
  doc: ActiveCommitDoc
  message: string
}

// --- Public events / DI input ---------------------------------------------

/** Commit the active document with this message. */
export const commitRequested = createEvent<{ message: string }>()
/** DI input from `wiring.ts`: the active document's `{ id, content, origin }`,
 * or `null` when there's no active document or it has no GitHub origin. */
export const activeDocumentForCommitChanged = createEvent<ActiveCommitDoc | null>()

/** Commit dialog open state (the small popover in the toolbar). */
export const commitDialogOpened = createEvent()
export const commitDialogClosed = createEvent()

/** Output: a commit landed — carries the new sha merged into the origin.
 * `wiring.ts` samples this into `documents`' `documentGithubSynced`. */
export const commitSucceeded = createEvent<{ id: string; origin: GitHubOrigin }>()
/** Output: the "reload remote, discard local" conflict choice — carries the
 * fetched remote content and new sha. `wiring.ts` samples this into
 * `documents`' `documentRemoteApplied`. */
export const remoteReloadRequested = createEvent<{
  id: string
  content: string
  origin: GitHubOrigin
}>()

// --- Conflict-resolution choices (each an explicit user click) ------------

/** "Overwrite remote" — commit again using the freshly-fetched sha, so the
 * write still respects optimistic concurrency; the user consciously chooses
 * "my version wins". */
export const conflictOverwriteRequested = createEvent()
/** "Keep local only" — abandon this commit entirely; nothing is written,
 * local content and its (now-stale) recorded sha are left as-is. */
export const conflictKeepLocalRequested = createEvent()
/** "Reload remote and discard local" — replace local content with remote.
 * Routed out to `documents` via `remoteReloadRequested`. */
export const conflictReloadRemoteRequested = createEvent()

// --- Internal events ------------------------------------------------------

const commitStarted = createEvent<CommitInput>()
const commitConflicted = createEvent()
const commitErrored = createEvent<string>()

// --- Effects --------------------------------------------------------------

const commitFileFx = createEffect(({ doc, message }: CommitInput): Promise<{ sha: string }> => {
  const token = getActiveToken()
  if (token === null) {
    return Promise.reject(new Error('Not connected to GitHub.'))
  }
  const { origin, content } = doc
  return commitFile(
    token,
    origin.owner,
    origin.repo,
    origin.path,
    origin.branch,
    content,
    message,
    origin.sha,
  )
})

// Fetches the current remote content + sha so the conflict choices have what
// they need without an extra round-trip once the user picks one.
const fetchRemoteFx = createEffect(
  async ({ doc }: CommitInput): Promise<{ content: string; sha: string }> => {
    const token = getActiveToken()
    if (token === null) {
      throw new Error('Not connected to GitHub.')
    }
    const { content, sha } = await getFileContent(
      token,
      doc.origin.owner,
      doc.origin.repo,
      doc.origin.path,
      doc.origin.branch,
    )
    return { content, sha }
  },
)

// --- Stores ---------------------------------------------------------------

export const $activeDocumentForCommit = createStore<ActiveCommitDoc | null>(null)
  .on(activeDocumentForCommitChanged, (_, doc) => doc)
  .reset(disconnectRequested)

export const $commitDialogOpen = createStore(false)
  .on(commitDialogOpened, () => true)
  .on(commitDialogClosed, () => false)

export const $commitStatus = createStore<CommitStatus>('idle')
  .on(commitFileFx, () => 'committing')
  .on(commitFileFx.done, () => 'done')
  .on(commitConflicted, () => 'conflict')
  .on(commitErrored, () => 'error')
  .on(conflictKeepLocalRequested, () => 'idle')
  .reset(commitDialogOpened, commitDialogClosed, disconnectRequested)

export const $commitError = createStore<string | null>(null)
  .on(commitErrored, (_, message) => message)
  .on(commitFileFx, () => null)
  .reset(commitDialogOpened, commitDialogClosed, conflictKeepLocalRequested, disconnectRequested)

/** The remote content+sha fetched after a conflict, ready for whichever
 * resolution the user picks. */
export const $conflictRemote = createStore<{ content: string; sha: string } | null>(null)
  .on(fetchRemoteFx.doneData, (_, remote) => remote)
  .reset(
    commitDialogOpened,
    commitDialogClosed,
    conflictKeepLocalRequested,
    commitSucceeded,
    disconnectRequested,
  )

// The in-flight commit snapshot. Not exported — internal to the conflict flow.
const $pendingCommit = createStore<CommitInput | null>(null)
  .on(commitStarted, (_, input) => input)
  .reset(
    commitDialogOpened,
    commitDialogClosed,
    conflictKeepLocalRequested,
    commitSucceeded,
    disconnectRequested,
  )

// --- Flow: initial commit -------------------------------------------------

/**
 * Combining `commitRequested`'s message with the active document has to
 * happen in a plain (non-narrowing) `fn` first: Effector's `sample` types
 * don't propagate a type-guard `filter`'s narrowing into that same step's
 * `fn` once a `source` and a payload-carrying `clock` are both involved
 * (verified empirically against this project's Effector version — see
 * `fileOpen.ts`'s `openFileFx` sample for the identical root cause). The
 * ordinary `if (doc === null) return null` below narrows fine *inside* this
 * plain function body — that's just normal control flow, not the thing that
 * fails — so the honest, cast-free split is: build the nullable candidate
 * here, then let a second, dedicated `sample` (single clock, type-guard
 * `filter`, no `fn` — the one shape that reliably narrows) forward only the
 * non-null case to `commitStarted`.
 */
const commitAttempted = createEvent<CommitInput | null>()

sample({
  clock: commitRequested,
  source: $activeDocumentForCommit,
  fn: (doc, { message }): CommitInput | null => (doc === null ? null : { doc, message }),
  target: commitAttempted,
})

sample({
  clock: commitAttempted,
  filter: (attempt): attempt is CommitInput => attempt !== null,
  target: commitStarted,
})

sample({ clock: commitStarted, target: commitFileFx })

// Success (both the first attempt and the overwrite path) -> merge the new
// sha into the origin and hand it back out.
sample({
  clock: commitFileFx.done,
  fn: ({ params, result }): { id: string; origin: GitHubOrigin } => ({
    id: params.doc.id,
    origin: { ...params.doc.origin, sha: result.sha },
  }),
  target: commitSucceeded,
})

sample({
  clock: commitSucceeded,
  fn: (): { text: string; tone: 'info' } => ({ text: 'Committed to GitHub.', tone: 'info' }),
  target: toastRequested,
})
// A landed commit closes the dialog (which also resets commit state).
sample({ clock: commitSucceeded, target: commitDialogClosed })

// --- Flow: failure split (conflict vs everything else) --------------------

sample({
  clock: commitFileFx.fail,
  filter: ({ error }) => error instanceof GitHubConflictError,
  target: commitConflicted,
})

sample({
  clock: commitFileFx.fail,
  filter: ({ error }) => !(error instanceof GitHubConflictError),
  fn: ({ error }): string =>
    error instanceof Error ? error.message : 'Could not commit to GitHub.',
  target: commitErrored,
})

// A non-conflict error is also surfaced as a toast (the dialog shows it too).
sample({
  clock: commitErrored,
  fn: (message): { text: string; tone: 'error' } => ({ text: message, tone: 'error' }),
  target: toastRequested,
})

// On conflict, fetch the latest remote in the background (no auto-retry, no
// default resolution) so the three choices are ready instantly.
sample({
  clock: commitConflicted,
  source: $pendingCommit,
  filter: (pending): pending is CommitInput => pending !== null,
  target: fetchRemoteFx,
})

// If even fetching the remote fails, downgrade to a plain error state rather
// than leaving the dialog stuck on "conflict" with no remote to act on.
sample({
  clock: fetchRemoteFx.fail,
  fn: ({ error }): string =>
    error instanceof Error ? error.message : 'Could not load the latest version from GitHub.',
  target: commitErrored,
})

// --- Flow: conflict resolution --------------------------------------------

// Overwrite: commit again with the fresh sha (still optimistic-concurrency
// safe — an explicit "my version wins", not a silent clobber). Same
// "build the nullable candidate in a plain fn, narrow it in a dedicated
// single-clock filter-only sample" split as the initial-commit flow above,
// and for the same reason (an object `source` combined with a `fn` doesn't
// let a type-guard `filter` narrow here either) — the ordinary null checks
// below are plain control flow inside a regular function body, not a cast.
const overwriteAttempted = createEvent<CommitInput | null>()

sample({
  clock: conflictOverwriteRequested,
  source: { pending: $pendingCommit, remote: $conflictRemote },
  fn: ({ pending, remote }): CommitInput | null => {
    if (pending === null || remote === null) return null
    return {
      doc: { ...pending.doc, origin: { ...pending.doc.origin, sha: remote.sha } },
      message: pending.message,
    }
  },
  target: overwriteAttempted,
})

sample({
  clock: overwriteAttempted,
  filter: (attempt): attempt is CommitInput => attempt !== null,
  target: commitStarted,
})

/** The "reload remote, discard local" conflict choice's payload — routed out
 * to `documents` (via `wiring.ts`) as an explicit discard of local edits,
 * only reachable by this click. */
interface RemoteReload {
  id: string
  content: string
  origin: GitHubOrigin
}
const remoteReloadAttempted = createEvent<RemoteReload | null>()

// Same split as the two flows above: a plain `fn` builds the nullable
// candidate (ordinary control-flow narrowing inside its body), a dedicated
// single-clock filter-only `sample` forwards only the non-null case.
sample({
  clock: conflictReloadRemoteRequested,
  source: { pending: $pendingCommit, remote: $conflictRemote },
  fn: ({ pending, remote }): RemoteReload | null => {
    if (pending === null || remote === null) return null
    return {
      id: pending.doc.id,
      content: remote.content,
      origin: { ...pending.doc.origin, sha: remote.sha },
    }
  },
  target: remoteReloadAttempted,
})

sample({
  clock: remoteReloadAttempted,
  filter: (attempt): attempt is RemoteReload => attempt !== null,
  target: remoteReloadRequested,
})
// Reloading resolves the conflict — close the dialog (which resets state).
sample({ clock: conflictReloadRemoteRequested, target: commitDialogClosed })

// If the active document loses its GitHub origin (switched to a local doc, or
// none), the commit dialog can't apply to anything — close it.
sample({
  clock: activeDocumentForCommitChanged,
  filter: (doc) => doc === null,
  target: commitDialogClosed,
})

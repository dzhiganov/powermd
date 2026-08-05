import { createEffect, createEvent, createStore, sample } from 'effector'

import { clearStoredToken, getStoredToken, maskToken, storeToken } from '../lib/token'
import { clearStoredConfig, getStoredConfig, storeConfig, type SyncConfig } from '../lib/config'
import { normalizeSubfolder, validateSubfolder } from '../lib/path'
import { validateToken, listBranches } from '../lib/api'
import type { GitHubRepo } from './types'

/**
 * Owns two nested lifecycles:
 *
 * 1. The token/authentication lifecycle (unchanged in spirit from the old
 *    per-file flow) — the raw token NEVER lives in a store here, only its
 *    masked form (`$maskedToken`) and the derived `$connectionStatus`. The
 *    token itself is read from / written to `lib/token.ts` (the one place
 *    it's persisted) and otherwise only ever passes transiently through an
 *    effect's params.
 * 2. The sync connection itself — which repo, branch, and (optional)
 *    subfolder documents sync to. This is the "pick a repo and go" wizard:
 *    once the token validates, `repoPicked`/`branchPicked`/
 *    `subfolderChanged` build up a candidate, and `connectSubmitted`
 *    finalizes it into `$syncConnection`, persisted via `lib/config.ts`.
 *    `$syncConnection` — not `$connectionStatus` — is what `model/sync.ts`
 *    and `model/import.ts` actually key their work off of: a validated
 *    token with no chosen repo yet does nothing.
 */

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

// --- Public events: token ---------------------------------------------------

/** Validate and connect with a pasted token. */
export const tokenSubmitted = createEvent<string>()
/** Disconnect: forget the token and the sync connection, and stop syncing.
 * Never deletes anything locally or remotely — it only forgets where (and
 * with what credential) to sync next. Other model files in this feature
 * reset their own stores on this event too. */
export const disconnectRequested = createEvent()

// --- Public events: the connect wizard --------------------------------------

export const repoPicked = createEvent<GitHubRepo>()
export const branchPicked = createEvent<string>()
export const subfolderChanged = createEvent<string>()
/** Finalizes the wizard's current repo/branch/subfolder choice into
 * `$syncConnection` — a no-op if a repo/branch hasn't been picked yet (see
 * the `filter` on the `sample` that consumes this, below). */
export const connectSubmitted = createEvent()
/** Output: a fresh connection was just finalized — carries the resulting
 * `SyncConfig`. Declared up here (rather than next to the `sample` that
 * fires it, further down) so the wizard stores below can reset off it
 * directly — see their own comment for why that has to be this event and
 * not `connectSubmitted` itself. */
export const syncConnected = createEvent<SyncConfig>()

// --- Effects: token ----------------------------------------------------------

const validateTokenFx = createEffect((token: string) => validateToken(token))
const storeTokenFx = createEffect((token: string) => storeToken(token))
const clearTokenFx = createEffect(() => clearStoredToken())

// --- Stores: token -------------------------------------------------------

export const $connectionStatus = createStore<ConnectionStatus>('disconnected')
  .on(validateTokenFx, () => 'connecting')
  .on(validateTokenFx.done, () => 'connected')
  .on(validateTokenFx.fail, () => 'error')
  .on(disconnectRequested, () => 'disconnected')

export const $authenticatedLogin = createStore<string | null>(null)
  .on(validateTokenFx.done, (_, { result }) => result.login)
  .on([validateTokenFx.fail, disconnectRequested], () => null)

/**
 * A short, actionable message for the current failure, or `null`. Distinct
 * per error type because each typed error from `lib/api.ts` already carries
 * its own specific, token-free message (bad/expired token vs network vs
 * other) — surfacing that message is what makes the states distinguishable.
 */
export const $connectionErrorMessage = createStore<string | null>(null)
  .on(validateTokenFx.fail, (_, { error }) => describeConnectionError(error))
  .on([validateTokenFx, disconnectRequested], () => null)

/** The masked token hint (`…AbC1`) for display only — never the raw token.
 * Updated from the validated token's params (transient), not from a stored
 * raw value. */
export const $maskedToken = createStore<string | null>(null)
  .on(validateTokenFx.done, (_, { params }) => maskToken(params))
  .on(disconnectRequested, () => null)

function describeConnectionError(error: unknown): string {
  // Every typed error from `lib/api.ts` has a safe, specific, token-free
  // message; fall back generically for anything unexpected.
  return error instanceof Error ? error.message : 'Could not connect to GitHub.'
}

// --- Flow: token -----------------------------------------------------------

// A blank submission would just 401 with a confusing message — validate a
// trimmed token and skip the round-trip if there's nothing to validate.
sample({
  clock: tokenSubmitted,
  fn: (token) => token.trim(),
  filter: (token) => token !== '',
  target: validateTokenFx,
})

// Persist the token only after it validates — never store an unverified or
// rejected token.
sample({ clock: validateTokenFx.done, fn: ({ params }) => params, target: storeTokenFx })

// Disconnecting forgets the token and the sync connection.
sample({ clock: disconnectRequested, target: clearTokenFx })

// --- Token access for sibling model files ---------------------------------

/** The single read path other model files in this feature use before calling
 * `lib/api.ts`. Reads from `lib/token.ts` (the one persistence point) rather
 * than duplicating storage access. `null` when disconnected. */
export function getActiveToken(): string | null {
  return getStoredToken()
}

// --- The connect wizard ------------------------------------------------------

// Reset on `syncConnected`, deliberately NOT on `connectSubmitted` itself:
// the `sample` below that turns a submitted wizard into a `SyncConfig` reads
// these same stores as its `source` off that very same `connectSubmitted`
// clock, and effector processes same-clock subscribers in declaration
// order — resetting here first would make that `source` read see the
// just-cleared values instead of the wizard's actual choice. `syncConnected`
// only ever fires strictly *after* that read has already happened (it's
// downstream of it), so resetting in response to it is race-free.
const $wizardRepo = createStore<GitHubRepo | null>(null)
  .on(repoPicked, (_, repo) => repo)
  .reset(disconnectRequested, syncConnected)

// Defaults to the repo's own reported default branch the instant it's
// picked — never hardcoded to `'main'` — and stays that way unless the user
// picks a different one from `$wizardBranches` below.
const $wizardBranch = createStore<string | null>(null)
  .on(repoPicked, (_, repo) => repo.defaultBranch)
  .on(branchPicked, (_, branch) => branch)
  .reset(disconnectRequested, syncConnected)

export const $wizardSubfolder = createStore('')
  .on(subfolderChanged, (_, value) => value)
  .reset(disconnectRequested, syncConnected)

export const $wizardSubfolderError = $wizardSubfolder.map((value) =>
  validateSubfolder(normalizeSubfolder(value)),
)

const fetchBranchesFx = createEffect((repo: GitHubRepo): Promise<string[]> => {
  const token = getActiveToken()
  if (token === null) return Promise.reject(new Error('Not connected to GitHub.'))
  return listBranches(token, repo.owner, repo.name)
})

sample({ clock: repoPicked, target: fetchBranchesFx })

export const $wizardBranchesLoading = fetchBranchesFx.pending

/** Same "the repo's own default branch is always an option, even before the
 * full list has loaded" guarantee as `$wizardBranch`'s default above — the
 * branch `<select>` in the UI is never left with nothing to show. */
export const $wizardBranches = createStore<string[]>([])
  .on(fetchBranchesFx.doneData, (_, branches) => branches)
  .reset(repoPicked, disconnectRequested, syncConnected)

export { $wizardRepo, $wizardBranch }

// --- Flow: finalizing the wizard into a live sync connection ---------------

interface WizardCandidate {
  repo: GitHubRepo
  branch: string
  subfolder: string
}

/**
 * Same "build the nullable candidate in a plain `fn`, narrow it in a
 * dedicated single-clock filter-only `sample`" split used throughout this
 * feature (see `model/sync.ts`'s doc comments for the fuller rationale): an
 * object `source` combined with a payload-carrying `clock` doesn't let a
 * type-guard `filter` narrow what a same-step `fn` receives.
 */
const wizardCandidateBuilt = createEvent<WizardCandidate | null>()

sample({
  clock: connectSubmitted,
  source: { repo: $wizardRepo, branch: $wizardBranch, subfolder: $wizardSubfolder },
  fn: ({ repo, branch, subfolder }): WizardCandidate | null =>
    repo === null || branch === null ? null : { repo, branch, subfolder },
  target: wizardCandidateBuilt,
})

sample({
  clock: wizardCandidateBuilt,
  filter: (candidate): candidate is WizardCandidate => {
    if (candidate === null) return false
    return validateSubfolder(normalizeSubfolder(candidate.subfolder)) === null
  },
  fn: (candidate): SyncConfig => {
    const c = candidate as WizardCandidate
    return {
      owner: c.repo.owner,
      repo: c.repo.name,
      branch: c.branch,
      subfolder: normalizeSubfolder(c.subfolder),
    }
  },
  target: syncConnected,
})

const storeConfigFx = createEffect((config: SyncConfig) => storeConfig(config))
const clearConfigFx = createEffect(() => clearStoredConfig())

sample({ clock: syncConnected, target: storeConfigFx })
sample({ clock: disconnectRequested, target: clearConfigFx })

/**
 * The active sync connection — `null` until the wizard has been completed at
 * least once. Seeded from persisted storage at module init so a reload
 * restores it without re-prompting; only `syncConnected` (an explicit
 * `connectSubmitted` from the wizard) advances it afterward, which is what
 * lets `model/import.ts` treat `syncConnected` specifically as "a *fresh*
 * connect just happened, run the first-connect import" without also firing
 * on every ordinary page load.
 */
export const $syncConnection = createStore<SyncConfig | null>(getStoredConfig())
  .on(syncConnected, (_, config) => config)
  .reset(disconnectRequested)

// --- Init -----------------------------------------------------------------

/**
 * Called once from `src/app/wiring.ts`. If a token was persisted in a prior
 * session, re-validate it on startup (rather than trusting it blindly) so
 * the connection state reflects reality after a reload — a since-revoked
 * token lands in the `error` state instead of silently appearing connected.
 * `$syncConnection` itself needs no equivalent kick: it's already seeded
 * synchronously from storage above, and `model/sync.ts` only acts on it once
 * a token is actually available (`getActiveToken()` inside its effects).
 * Same "plain function called once at startup" shape as
 * `initDocuments`/`initTransfer`.
 */
export function initGithub(): void {
  const stored = getStoredToken()
  if (stored !== null) {
    tokenSubmitted(stored)
  }
}

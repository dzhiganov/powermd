import { createEffect, createEvent, createStore, sample } from 'effector'

import { clearStoredToken, getStoredToken, maskToken, storeToken } from '../lib/token'
import { clearStoredConfig, getStoredConfig, storeConfig, type SyncConfig } from '../lib/config'
import { normalizeSubfolder, validateSubfolder } from '../lib/path'
import { validateToken, listBranches, GitHubAuthError } from '../lib/api'
import { clearAppAuthMeta, getStoredAppAuthMeta, storeAppAuthMeta } from '../lib/appAuth'
import { refreshAppToken, GitHubAppAuthError } from '../lib/appApi'
import {
  clearCredentialKind,
  storeCredentialKind,
  type CredentialKind,
} from '../lib/credentialKind'
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
 *
 * Also owns `callWithToken` (bottom of this file) — the refresh-on-401
 * wrapper every network-calling effect in this feature (`model/sync.ts`,
 * `model/repos.ts`, `model/import.ts`, and this file's own
 * `fetchBranchesFx`) goes through instead of calling `getActiveToken`
 * directly. It lives here rather than its own module because it needs to
 * both read `getActiveToken` and fire `reauthRequired` into
 * `$connectionStatus`, and putting it in a separate file that either side
 * imports from would make a cycle with this one either way.
 */

export type ConnectionStatus =
  'disconnected' | 'connecting' | 'connected' | 'error' | 'reauth-required'

// --- Public events: token ---------------------------------------------------

/** Validate and connect with a pasted token. */
export const tokenSubmitted = createEvent<string>()

/** Declares which kind of credential `tokenSubmitted` is about to carry —
 * fired by whichever flow obtained it (`ui/GitHubSyncPanel.vue`'s PAT form
 * with `'pat'`, `model/oauth.ts`'s exchange with `'app'`) BEFORE or
 * alongside its own `tokenSubmitted` call. Never fired by `initGithub()`'s
 * startup re-validation of an already-stored token, so a reload preserves
 * whichever kind was last declared instead of resetting it. See
 * `lib/credentialKind.ts`'s doc comment for why this can't be inferred from
 * the token or from `lib/appAuth.ts`'s refresh metadata instead. */
export const credentialKindDeclared = createEvent<CredentialKind>()
/** Disconnect: forget the token and the sync connection, and stop syncing.
 * Never deletes anything locally or remotely — it only forgets where (and
 * with what credential) to sync next. Other model files in this feature
 * reset their own stores on this event too. */
export const disconnectRequested = createEvent()

/** A GitHub-App-connected session's access token expired AND could not be
 * refreshed (no refresh token stored, the refresh token itself expired, or
 * the refresh call failed) — fired by `callWithToken` at the bottom of this
 * file. Unlike `disconnectRequested`, this deliberately does NOT clear
 * `$syncConnection`: the repo/branch/subfolder choice is still valid, only
 * the credential needs replacing, so a fresh sign-in resumes syncing to the
 * same place rather than re-running the connect wizard. */
export const reauthRequired = createEvent()

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

const storeCredentialKindFx = createEffect((kind: CredentialKind) => storeCredentialKind(kind))
sample({ clock: credentialKindDeclared, target: storeCredentialKindFx })

// Forgets the credential without forgetting the sync target — see
// `reauthRequired`'s own doc comment above for why this stops short of
// `clearTokenFx`+`clearConfigFx` (that pairing is `disconnectRequested`'s
// job, further down).
const clearCredentialOnReauthFx = createEffect(() => {
  clearStoredToken()
  clearAppAuthMeta()
})
sample({ clock: reauthRequired, target: clearCredentialOnReauthFx })

// --- Stores: token -------------------------------------------------------

export const $connectionStatus = createStore<ConnectionStatus>('disconnected')
  .on(validateTokenFx, () => 'connecting')
  .on(validateTokenFx.done, () => 'connected')
  .on(validateTokenFx.fail, () => 'error')
  .on(disconnectRequested, () => 'disconnected')
  .on(reauthRequired, () => 'reauth-required')

export const $authenticatedLogin = createStore<string | null>(null)
  .on(validateTokenFx.done, (_, { result }) => result.login)
  .on([validateTokenFx.fail, disconnectRequested, reauthRequired], () => null)

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
  .on([disconnectRequested, reauthRequired], () => null)

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

// Disconnecting forgets the token, any GitHub App refresh-token metadata,
// the declared credential kind, and the sync connection (the last of those
// further down, alongside `$syncConnection`'s own `.reset`).
const clearAppAuthOnDisconnectFx = createEffect(() => clearAppAuthMeta())
const clearCredentialKindOnDisconnectFx = createEffect(() => clearCredentialKind())
sample({
  clock: disconnectRequested,
  target: [clearTokenFx, clearAppAuthOnDisconnectFx, clearCredentialKindOnDisconnectFx],
})

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
  return callWithToken((token) => listBranches(token, repo.owner, repo.name))
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

// --- Auth retry (refresh-on-401) --------------------------------------------
//
// GitHub App user tokens may be configured to expire (8 hours, with a
// refresh token) or not — this app has to work correctly either way. A
// personal access token never expires this way at all. `callWithToken` is
// the one place that decides what a 401 means and what to do about it, so
// `model/sync.ts`, `model/repos.ts`, `model/import.ts`, and this file's own
// `fetchBranchesFx` above all get the same behavior for free rather than
// each re-implementing it.

/** Surfaced (via `describeSyncError`/`$reposError`/`$importError`, which all
 * already just render `error.message`) when a 401 could not be resolved by
 * one refresh attempt — no refresh token to try (a PAT, or a GitHub App
 * connection with expiration disabled), the refresh token itself expired,
 * or the refresh call failed. `reauthRequired` has already fired by the time
 * this is thrown (see `callWithToken` below), so `$connectionStatus` is
 * already `'reauth-required'` for the UI to react to alongside this
 * message. */
export class GitHubReauthRequiredError extends Error {
  constructor() {
    super('Your GitHub sign-in expired. Sign in again to continue syncing.')
    this.name = 'GitHubReauthRequiredError'
  }
}

// Concurrent 401s (e.g. a push and a repo-list fetch failing in the same
// moment) share one in-flight refresh rather than each starting their own —
// GitHub App refresh tokens are typically single-use (using one invalidates
// it and issues a new one), so a second concurrent refresh call would race
// the first and fail.
let refreshInFlight: Promise<string> | null = null

async function performRefresh(): Promise<string> {
  const meta = getStoredAppAuthMeta()
  if (meta === null) throw new GitHubReauthRequiredError()

  let result
  try {
    result = await refreshAppToken(meta.refreshToken)
  } catch (error) {
    throw error instanceof GitHubAppAuthError ? new GitHubReauthRequiredError() : error
  }

  storeToken(result.accessToken)
  if (result.refreshToken !== null) {
    storeAppAuthMeta({
      refreshToken: result.refreshToken,
      expiresAt: result.expiresAt !== null ? new Date(result.expiresAt).getTime() : null,
      refreshTokenExpiresAt:
        result.refreshTokenExpiresAt !== null
          ? new Date(result.refreshTokenExpiresAt).getTime()
          : null,
    })
  } else {
    clearAppAuthMeta()
  }
  return result.accessToken
}

function refreshOnce(): Promise<string> {
  if (refreshInFlight === null) {
    refreshInFlight = performRefresh().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

/**
 * Runs `operation` with the current access token. On a `GitHubAuthError`
 * (401), attempts exactly ONE refresh (deduped across concurrent callers via
 * `refreshOnce`) and retries `operation` once with the fresh token. If that
 * retry also fails, or there was nothing to refresh in the first place,
 * `reauthRequired` fires — clearing the stored credential and moving
 * `$connectionStatus` to `'reauth-required'` — and a `GitHubReauthRequiredError`
 * propagates to the caller instead of retrying further; nothing above this
 * function loops or keeps hammering GitHub with an expired token.
 */
export async function callWithToken<T>(operation: (token: string) => Promise<T>): Promise<T> {
  const token = getActiveToken()
  if (token === null) throw new Error('Not connected to GitHub.')

  try {
    return await operation(token)
  } catch (error) {
    if (!(error instanceof GitHubAuthError)) throw error
    try {
      const freshToken = await refreshOnce()
      return await operation(freshToken)
    } catch {
      reauthRequired()
      throw new GitHubReauthRequiredError()
    }
  }
}

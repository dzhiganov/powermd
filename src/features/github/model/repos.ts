import { createEffect, createEvent, createStore, sample } from 'effector'

import { listAllRepos, listAllAppRepos } from '../lib/api'
import { getStoredCredentialKind } from '../lib/credentialKind'
import type { GitHubRepo } from './types'
import { callWithToken, disconnectRequested } from './connection'

/** The list of repositories the connected token can act on. Fetched when the
 * browse UI opens (or a manual refresh), reset on disconnect. */

export const reposRequested = createEvent()

/**
 * Picks the repository-listing path for the active credential kind — a
 * personal access token lists everything it's affiliated with directly
 * (`listAllRepos`), a GitHub App token can only see repositories the App
 * was installed on (`listAllAppRepos`, walking installations). `null` (no
 * kind ever declared — a connection made before `lib/credentialKind.ts`
 * existed) defaults to the PAT path, the only one that existed then.
 *
 * Exported so this branch is testable directly (`repos.test.ts`) without
 * driving the full `reposRequested` -> `fetchReposFx` effector chain.
 */
export function listReposForActiveCredential(token: string): Promise<GitHubRepo[]> {
  return getStoredCredentialKind() === 'app' ? listAllAppRepos(token) : listAllRepos(token)
}

// `callWithToken` (`./connection.ts`) throws its own "Not connected to
// GitHub." when there's no active token — reachable here only if the UI
// requests repos while disconnected, a programming error — and handles a
// 401 mid-flight with one refresh-and-retry before giving up.
const fetchReposFx = createEffect((): Promise<GitHubRepo[]> => {
  return callWithToken((token) => listReposForActiveCredential(token))
})

export const $repos = createStore<GitHubRepo[]>([])
  .on(fetchReposFx.doneData, (_, repos) => repos)
  .reset(disconnectRequested)

export const $reposLoading = fetchReposFx.pending

export const $reposError = createStore<string | null>(null)
  .on(fetchReposFx.fail, (_, { error }) =>
    error instanceof Error ? error.message : 'Could not load repositories.',
  )
  .on([fetchReposFx, fetchReposFx.done], () => null)
  .reset(disconnectRequested)

sample({ clock: reposRequested, target: fetchReposFx })

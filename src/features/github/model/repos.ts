import { createEffect, createEvent, createStore, sample } from 'effector'

import { listAllRepos } from '../lib/api'
import type { GitHubRepo } from './types'
import { callWithToken, disconnectRequested } from './connection'

/** The list of repositories the connected token can act on. Fetched when the
 * browse UI opens (or a manual refresh), reset on disconnect. */

export const reposRequested = createEvent()

// `callWithToken` (`./connection.ts`) throws its own "Not connected to
// GitHub." when there's no active token — reachable here only if the UI
// requests repos while disconnected, a programming error — and handles a
// 401 mid-flight with one refresh-and-retry before giving up.
const fetchReposFx = createEffect((): Promise<GitHubRepo[]> => {
  return callWithToken((token) => listAllRepos(token))
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

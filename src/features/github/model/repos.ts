import { createEffect, createEvent, createStore, sample } from 'effector'

import { listAllRepos } from '../lib/api'
import type { GitHubRepo } from './types'
import { disconnectRequested, getActiveToken } from './connection'

/** The list of repositories the connected token can act on. Fetched when the
 * browse UI opens (or a manual refresh), reset on disconnect. */

export const reposRequested = createEvent()

const fetchReposFx = createEffect((): Promise<GitHubRepo[]> => {
  const token = getActiveToken()
  if (token === null) {
    // Only reachable if the UI requests repos while disconnected — a
    // programming error, surfaced as a plain (token-free) message.
    return Promise.reject(new Error('Not connected to GitHub.'))
  }
  return listAllRepos(token)
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

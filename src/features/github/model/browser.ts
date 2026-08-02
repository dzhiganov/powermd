import { combine, createEffect, createEvent, createStore, sample } from 'effector'

import { getTree } from '../lib/api'
import type { GitHubRepo, GitHubTreeEntry } from './types'
import { disconnectRequested, getActiveToken } from './connection'

/**
 * Browsing one repository's tree. The whole recursive tree is fetched once
 * per repo (a single API call); folder navigation after that is pure
 * client-side filtering of that flat list, so opening a subfolder or going
 * back up never hits the network again.
 */

// --- Events ---------------------------------------------------------------

/** Select a repo to browse — fetches its recursive tree at its default
 * branch. */
export const repoSelected = createEvent<GitHubRepo>()
/** Navigate into a folder (its full repo-root-relative path). */
export const folderOpened = createEvent<string>()
/** Go up one level (to the parent folder, or the repo root). */
export const folderUpToRequested = createEvent()
/** Leave the tree view and return to the repo list. */
export const backToRepoListRequested = createEvent()

// --- Effect ---------------------------------------------------------------

const fetchTreeFx = createEffect(
  (repo: GitHubRepo): Promise<{ entries: GitHubTreeEntry[]; truncated: boolean }> => {
    const token = getActiveToken()
    if (token === null) {
      return Promise.reject(new Error('Not connected to GitHub.'))
    }
    return getTree(token, repo.owner, repo.name, repo.defaultBranch)
  },
)

// --- Stores ---------------------------------------------------------------

export const $selectedRepo = createStore<GitHubRepo | null>(null)
  .on(repoSelected, (_, repo) => repo)
  .reset(backToRepoListRequested, disconnectRequested)

export const $treeEntries = createStore<GitHubTreeEntry[]>([])
  .on(fetchTreeFx.doneData, (_, { entries }) => entries)
  .reset(repoSelected, backToRepoListRequested, disconnectRequested)

export const $treeTruncated = createStore(false)
  .on(fetchTreeFx.doneData, (_, { truncated }) => truncated)
  .reset(repoSelected, backToRepoListRequested, disconnectRequested)

export const $treeLoading = fetchTreeFx.pending

export const $treeError = createStore<string | null>(null)
  .on(fetchTreeFx.fail, (_, { error }) =>
    error instanceof Error ? error.message : 'Could not load this repository.',
  )
  .on(repoSelected, () => null)
  .reset(backToRepoListRequested, disconnectRequested)

/** The folder currently being viewed, repo-root-relative (`''` = repo root).
 * Reset to root whenever a new repo is selected or the tree view is left. */
export const $currentFolderPath = createStore('')
  .on(folderOpened, (_, path) => path)
  .on(folderUpToRequested, (path) => parentPath(path))
  .reset(repoSelected, backToRepoListRequested, disconnectRequested)

// --- Path helpers ---------------------------------------------------------

/** The parent of a repo-root-relative path (`''` for a top-level path). */
function parentPath(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? '' : path.slice(0, idx)
}

/** The last segment of a path — used as an entry's display label and for
 * sorting. */
export function entryName(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? path : path.slice(idx + 1)
}

function isMarkdownPath(path: string): boolean {
  const lower = path.toLowerCase()
  return lower.endsWith('.md') || lower.endsWith('.markdown')
}

function byName(a: GitHubTreeEntry, b: GitHubTreeEntry): number {
  return entryName(a.path).localeCompare(entryName(b.path), undefined, { sensitivity: 'base' })
}

// --- Derived: what's visible at the current folder level ------------------
//
// The recursive tree already includes a `type: 'tree'` entry for every real
// directory, so folders at this level are just the tree entries whose parent
// is the current folder — no need to synthesize folder pseudo-entries from
// blob paths. Markdown files are the blob entries at this level ending in
// `.md`/`.markdown` (case-insensitive). Everything else (non-markdown blobs,
// deeper entries) is filtered out.
export const $visibleFolders = combine($treeEntries, $currentFolderPath, (entries, cwd) =>
  entries.filter((entry) => entry.type === 'tree' && parentPath(entry.path) === cwd).sort(byName),
)

export const $visibleMarkdownFiles = combine($treeEntries, $currentFolderPath, (entries, cwd) =>
  entries
    .filter(
      (entry) =>
        entry.type === 'blob' && parentPath(entry.path) === cwd && isMarkdownPath(entry.path),
    )
    .sort(byName),
)

/** True when the current folder has neither subfolders nor markdown files to
 * show (drives the browser's empty state). */
export const $currentFolderEmpty = combine(
  $visibleFolders,
  $visibleMarkdownFiles,
  (folders, files) => folders.length === 0 && files.length === 0,
)

// --- Flow -----------------------------------------------------------------

sample({ clock: repoSelected, target: fetchTreeFx })

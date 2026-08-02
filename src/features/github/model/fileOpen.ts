import { createEffect, createEvent, sample } from 'effector'

import { toastRequested } from '@/shared/lib/toast'
import type { GitHubOrigin } from '@/features/documents'

import { getFileContent } from '../lib/api'
import type { GitHubRepo, GitHubTreeEntry } from './types'
import { getActiveToken } from './connection'
import { $selectedRepo, entryName } from './browser'
import { githubModalClosed } from './dialog'

/**
 * Opening a markdown file from the browsed repo as a new local document. The
 * file's decoded content and the blob sha it matched become the new
 * document's content and its `GitHubOrigin` (so it can be committed back).
 *
 * `github` may import `@/features/documents`'s public API for the
 * `GitHubOrigin` type (one-directional); `documents` never imports `github`.
 * The actual document creation happens in `documents` — `wiring.ts` samples
 * the `fileOpened` event below into `documentOpenedFromOrigin`.
 */

export const fileOpenRequested = createEvent<GitHubTreeEntry>()

/**
 * `repo` is genuinely `GitHubRepo | null` here — it's `$selectedRepo` read
 * straight off the `sample` below, and the `filter` on that `sample` only
 * gates whether the effect *runs*, it does not (and, via a plain boolean
 * filter, cannot) narrow the type `fn` produces. Rather than force that
 * narrowing with a cast, the null case is handled for real inside the effect
 * below — belt-and-suspenders with the filter, and honest about what the type
 * actually allows.
 */
interface OpenFilePayload {
  repo: GitHubRepo | null
  entry: GitHubTreeEntry
}

const openFileFx = createEffect(
  async ({
    repo,
    entry,
  }: OpenFilePayload): Promise<{ title: string; content: string; origin: GitHubOrigin }> => {
    if (repo === null) {
      // Unreachable in practice — the `sample` below only invokes this effect
      // when `$selectedRepo` is non-null — but the type is honestly nullable,
      // so this stays a real guard rather than an assumption.
      throw new Error('No repository selected.')
    }
    const token = getActiveToken()
    if (token === null) {
      throw new Error('Not connected to GitHub.')
    }
    const { content, sha } = await getFileContent(
      token,
      repo.owner,
      repo.name,
      entry.path,
      repo.defaultBranch,
    )
    const origin: GitHubOrigin = {
      owner: repo.owner,
      repo: repo.name,
      branch: repo.defaultBranch,
      path: entry.path,
      sha,
    }
    return { title: stripExtension(entryName(entry.path)), content, origin }
  },
)

/** Strip a trailing `.ext` for the document title — same rule as
 * `features/transfer`'s import path (`readme.md` -> `readme`). Reimplemented
 * here rather than imported because features can't import each other's
 * internals. */
function stripExtension(filename: string): string {
  const index = filename.lastIndexOf('.')
  return index <= 0 ? filename : filename.slice(0, index)
}

/**
 * Output event: a file has been fetched and decoded and is ready to become a
 * new document. `wiring.ts` samples this into `documentOpenedFromOrigin`
 * (`@/features/documents`'s public API) — the connection lives there, not
 * here, for the same reason as every other cross-feature link.
 */
export const fileOpened = createEvent<{ title: string; content: string; origin: GitHubOrigin }>()

sample({
  clock: fileOpenRequested,
  source: $selectedRepo,
  filter: (repo) => repo !== null,
  fn: (repo, entry): OpenFilePayload => ({ repo, entry }),
  target: openFileFx,
})

sample({ clock: openFileFx.doneData, target: fileOpened })

// Opening succeeded — close the browse modal so the editor is visible.
sample({ clock: fileOpened, target: githubModalClosed })

// Surface any open failure (too large, network, permission, rate limit) as a
// toast — each typed error from `lib/api.ts` already carries an actionable,
// token-free message.
sample({
  clock: openFileFx.fail,
  fn: ({ error }): { text: string; tone: 'error' } => ({
    text: error instanceof Error ? error.message : 'Could not open this file.',
    tone: 'error',
  }),
  target: toastRequested,
})

/**
 * Thin, typed client over the GitHub REST API. Browser-direct: GitHub's REST
 * API sends permissive CORS headers, so a fine-grained personal access token
 * pasted into the app can call it with no backend and no OAuth.
 *
 * Every failure is turned into one of the typed error classes below, so the
 * model layer can react precisely (a 401 is not a 404 is not a rate limit).
 * A token is NEVER placed in any error message, and is NEVER logged.
 */
import type { GitHubRepo, GitHubTreeEntry } from '../model/types'
import { base64ToUtf8, utf8ToBase64 } from './base64'

const API_BASE = 'https://api.github.com'

// --- Typed errors ---------------------------------------------------------
//
// Each is a plain `Error` subclass; none carries the token in its message.

/** 401 — the token is invalid, expired, or revoked. */
export class GitHubAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitHubAuthError'
  }
}

/** 403 that is NOT a rate limit — e.g. the token lacks the permission/scope
 * this request needs on this repository. */
export class GitHubForbiddenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitHubForbiddenError'
  }
}

/** 429, or a 403 whose `x-ratelimit-remaining` is `0`. `resetAt` is when the
 * limit is expected to reset (a real class field, not a bag-on-error hack). */
export class GitHubRateLimitError extends Error {
  readonly resetAt: Date
  constructor(message: string, resetAt: Date) {
    super(message)
    this.name = 'GitHubRateLimitError'
    this.resetAt = resetAt
  }
}

/** 404 — the resource doesn't exist, or the token can't see it. */
export class GitHubNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitHubNotFoundError'
  }
}

/** 409 — sha mismatch on a write (the file changed on GitHub since it was
 * opened). */
export class GitHubConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitHubConflictError'
  }
}

/** The file is too large for the API path being used to return usable
 * content. */
export class GitHubTooLargeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitHubTooLargeError'
  }
}

/** 422 — GitHub rejected the request as semantically invalid for this
 * endpoint. `updateRef` gives this (and a 409) its own meaning: either is
 * what a non-fast-forward ref move looks like, and `updateRef` translates it
 * into the more specific `GitHubRefConflictError` for that case. */
export class GitHubUnprocessableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitHubUnprocessableError'
  }
}

/** `updateRef` was rejected because the branch moved since this sync cycle
 * read it (a non-fast-forward update, or the ref itself changed under a
 * concurrent writer) — GitHub reports this as either a 422 or a 409
 * depending on exactly what moved. `model/sync.ts` catches this specifically
 * to refetch the ref and base tree and retry the whole batch against the new
 * base, rather than ever force-pushing over someone else's commit. */
export class GitHubRefConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitHubRefConflictError'
  }
}

/** `fetch` itself threw — offline, DNS failure, CORS preflight failure, etc.
 * (as opposed to the server returning an error status). */
export class GitHubNetworkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitHubNetworkError'
  }
}

// --- Core request ---------------------------------------------------------

/** `GET /repos/owner/name/git/ref/heads/main` — the request, with no token in
 * it. Used only to make otherwise-undiagnosable statuses actionable. */
function describeRequest(init: RequestInit, path: string): string {
  return `${(init.method ?? 'GET').toUpperCase()} ${path}`
}

/** GitHub's own `message` field, if the body carries one. Returns an empty
 * string rather than throwing when the body is missing or not JSON, since
 * this only ever decorates an error that is already being raised. */
async function githubMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.clone().json()
    if (body !== null && typeof body === 'object' && 'message' in body) {
      const message = (body as { message: unknown }).message
      if (typeof message === 'string' && message !== '') return ` — ${message}`
    }
  } catch {
    // Body absent or not JSON; the request description alone is enough.
  }
  return ''
}

async function githubRequest(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<Response> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      // GitHub sends validators on GETs, so the browser will happily serve a
      // cached ref lookup — returning a tip from before this app's own last
      // push. Every commit then gets built on a stale parent and rejected as
      // not a fast forward, identically on every retry, since the retry
      // re-reads the same cached response rather than the moved branch.
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...init.headers,
      },
    })
  } catch {
    // Deliberately swallow the original error's message — a fetch rejection
    // never contains the token, but re-throwing an app-controlled message
    // keeps that guarantee unconditional.
    throw new GitHubNetworkError('Could not reach GitHub. Check your connection and try again.')
  }

  if (response.status === 401) {
    throw new GitHubAuthError('GitHub rejected this token — it may be invalid or expired.')
  }
  if (response.status === 404) {
    throw new GitHubNotFoundError('Not found on GitHub, or this token cannot see it.')
  }
  if (response.status === 409) {
    // 409 is overloaded on the git endpoints. Notably GitHub answers a ref
    // lookup on a repository with zero commits with 409 "Git Repository is
    // empty." rather than 404, so `getBranchRef` treats this as "no ref yet"
    // instead of an error — see its catch block.
    //
    // The method, path and GitHub's own message are included because a bare
    // "conflict" is undiagnosable: this status arrives from several different
    // endpoints for unrelated reasons. The path contains only owner/repo/ref
    // names, never the token, which travels solely in the Authorization
    // header above.
    throw new GitHubConflictError(
      `GitHub reported a conflict: ${describeRequest(init, path)}${await githubMessage(response)}`,
    )
  }
  if (response.status === 403 || response.status === 429) {
    const remaining = response.headers.get('x-ratelimit-remaining')
    const resetHeader = response.headers.get('x-ratelimit-reset')
    if (response.status === 429 || remaining === '0') {
      const resetAt = resetHeader
        ? new Date(Number(resetHeader) * 1000)
        : new Date(Date.now() + 60_000)
      throw new GitHubRateLimitError(
        `GitHub API rate limit reached. Try again after ${resetAt.toLocaleTimeString()}.`,
        resetAt,
      )
    }
    throw new GitHubForbiddenError(
      'GitHub denied this request — the token may lack the required repository permission.',
    )
  }
  if (response.status === 422) {
    // Like 409 above, 422 covers several unrelated rejections, so the request
    // and GitHub's own message are carried through rather than flattened into
    // a status name that identifies nothing. Callers that translate this into
    // a more specific error propagate the wording with it.
    throw new GitHubUnprocessableError(
      `GitHub rejected this request: ${describeRequest(init, path)}${await githubMessage(response)}`,
    )
  }
  if (!response.ok) {
    throw new Error(`GitHub request failed (status ${response.status}).`)
  }
  return response
}

/** Encodes a repo-root-relative path for a URL while preserving the `/`
 * separators GitHub expects (each segment is percent-encoded on its own). */
function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

// --- Raw response shapes (projected down by the exported functions) -------

interface RawUser {
  login: string
}

interface RawRepo {
  id: number
  name: string
  full_name: string
  owner: { login: string }
  default_branch: string
  private: boolean
}

interface RawTree {
  tree: Array<{ path: string; type: string; sha: string; size?: number }>
  truncated: boolean
}

interface RawContent {
  content?: string
  sha?: string
  size?: number
}

interface RawBlob {
  content?: string
  size?: number
}

function mapRepo(raw: RawRepo): GitHubRepo {
  return {
    id: raw.id,
    name: raw.name,
    fullName: raw.full_name,
    owner: raw.owner.login,
    defaultBranch: raw.default_branch,
    private: raw.private,
  }
}

// --- Exported operations --------------------------------------------------

/** Confirms a token is valid and returns the authenticated login. */
export async function validateToken(token: string): Promise<{ login: string }> {
  const response = await githubRequest('/user', token)
  const user = (await response.json()) as RawUser
  return { login: user.login }
}

const REPOS_PER_PAGE = 100
const MAX_REPO_PAGES = 20

/** Lists every repo the token can act on, paginating until a short page ends
 * the walk (hard-capped at `MAX_REPO_PAGES` as a sanity bound). */
export async function listAllRepos(token: string): Promise<GitHubRepo[]> {
  const repos: GitHubRepo[] = []
  for (let page = 1; page <= MAX_REPO_PAGES; page += 1) {
    const response = await githubRequest(
      `/user/repos?per_page=${REPOS_PER_PAGE}&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
      token,
    )
    const rawPage = (await response.json()) as RawRepo[]
    for (const raw of rawPage) {
      repos.push(mapRepo(raw))
    }
    if (rawPage.length < REPOS_PER_PAGE) break
  }
  return repos
}

/** Re-fetches a single repo (used to re-confirm its default branch). */
export async function getRepo(token: string, owner: string, repo: string): Promise<GitHubRepo> {
  const response = await githubRequest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    token,
  )
  const raw = (await response.json()) as RawRepo
  return mapRepo(raw)
}

interface RawBranch {
  name: string
}

const BRANCHES_PER_PAGE = 100
const MAX_BRANCH_PAGES = 10

/** Lists every branch name in a repo — the "Save to GitHub" flow's branch
 * picker. Paginated the same way `listAllRepos` is. Never creates a branch;
 * this only ever reads what already exists. */
export async function listBranches(token: string, owner: string, repo: string): Promise<string[]> {
  const branches: string[] = []
  for (let page = 1; page <= MAX_BRANCH_PAGES; page += 1) {
    const response = await githubRequest(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=${BRANCHES_PER_PAGE}&page=${page}`,
      token,
    )
    const rawPage = (await response.json()) as RawBranch[]
    for (const raw of rawPage) {
      branches.push(raw.name)
    }
    if (rawPage.length < BRANCHES_PER_PAGE) break
  }
  return branches
}

/** Fetches a repo's full recursive git tree at a branch. `truncated` is
 * surfaced so the UI can say "showing a partial file list" rather than
 * silently missing files. */
export async function getTree(
  token: string,
  owner: string,
  repo: string,
  branch: string,
): Promise<{ entries: GitHubTreeEntry[]; truncated: boolean }> {
  let response: Response
  try {
    response = await githubRequest(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      token,
    )
  } catch (error) {
    // A repository with no commits has no tree to read. GitHub reports that
    // as 409 "Git Repository is empty." here, and as 404 when the repo exists
    // but this branch does not. Neither is a failure for this app's purposes:
    // there is simply nothing to import, and the first push will create the
    // initial commit. Same reasoning as `getBranchRef` below.
    if (error instanceof GitHubConflictError || error instanceof GitHubNotFoundError) {
      return { entries: [], truncated: false }
    }
    throw error
  }
  const raw = (await response.json()) as RawTree
  const entries: GitHubTreeEntry[] = []
  for (const entry of raw.tree) {
    if (entry.type !== 'blob' && entry.type !== 'tree') continue
    entries.push({ path: entry.path, type: entry.type, sha: entry.sha, size: entry.size })
  }
  return { entries, truncated: raw.truncated === true }
}

// The Blobs API works up to ~100MB; anything past that (or an unreported,
// clearly-absurd size) isn't something this editor can usefully open.
const MAX_FILE_BYTES = 100 * 1024 * 1024

/**
 * Reads a file's decoded UTF-8 content and blob sha at a ref. Falls back from
 * the Contents API (inline content capped at ~1MB) to the Blobs API (~100MB)
 * when the Contents response omits the content but gives a sha. Throws
 * `GitHubTooLargeError` when neither path yields usable content or the
 * reported size is beyond what's openable here.
 */
export async function getFileContent(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<{ content: string; sha: string; sizeBytes: number }> {
  const encodedOwner = encodeURIComponent(owner)
  const encodedRepo = encodeURIComponent(repo)
  const response = await githubRequest(
    `/repos/${encodedOwner}/${encodedRepo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`,
    token,
  )
  const raw = (await response.json()) as RawContent
  const sha = typeof raw.sha === 'string' ? raw.sha : ''
  const sizeBytes = typeof raw.size === 'number' ? raw.size : 0

  if (sizeBytes > MAX_FILE_BYTES) {
    throw new GitHubTooLargeError('This file is too large to open in the editor.')
  }

  // Contents API inlined the content — the common case for a markdown file.
  if (typeof raw.content === 'string' && raw.content.length > 0) {
    return { content: base64ToUtf8(raw.content), sha, sizeBytes }
  }

  // Over the Contents API's ~1MB inline limit: the content field comes back
  // empty but the sha lets us pull the full blob from the Blobs API.
  if (sha !== '') {
    const blobResponse = await githubRequest(
      `/repos/${encodedOwner}/${encodedRepo}/git/blobs/${encodeURIComponent(sha)}`,
      token,
    )
    const blob = (await blobResponse.json()) as RawBlob
    const blobSize = typeof blob.size === 'number' ? blob.size : sizeBytes
    if (blobSize > MAX_FILE_BYTES) {
      throw new GitHubTooLargeError('This file is too large to open in the editor.')
    }
    if (typeof blob.content === 'string' && blob.content.length > 0) {
      return { content: base64ToUtf8(blob.content), sha, sizeBytes: blobSize }
    }
  }

  throw new GitHubTooLargeError('This file is too large to open in the editor.')
}

// --- Git Data API — batched, multi-file commits ----------------------------
//
// The Contents API (`getFileContent` above) is one file per request, fine
// for reading, but committing that way is one commit per file — with
// autosave-driven background sync that's commit spam and burns the rate
// limit fast. `model/sync.ts` instead batches every dirty document into one
// commit using the lower-level Git Data API: read the branch tip, build a
// new tree on top of it (via `base_tree`, so every untouched file is
// preserved without being re-specified), commit that tree, then move the
// branch ref to point at the new commit. These five functions are exactly
// that sequence, one call each.

interface RawRef {
  object: { sha: string }
}

/** The branch's current commit sha, or `null` specifically when the ref
 * doesn't exist — which this app only ever expects for a genuinely empty
 * repository (zero commits, so no branch exists yet). `model/sync.ts` reacts
 * to `null` by building the very first commit with no parent and no
 * `base_tree`, then creating the ref (`createRef`) instead of moving an
 * existing one (`updateRef`). */
export async function getBranchRef(
  token: string,
  owner: string,
  repo: string,
  branch: string,
): Promise<{ sha: string } | null> {
  try {
    const response = await githubRequest(
      // See `updateRef`: `heads/` is a separator here, not part of the name.
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(branch)}`,
      token,
    )
    const raw = (await response.json()) as RawRef
    return { sha: raw.object.sha }
  } catch (error) {
    // A repository with zero commits has no branch yet. GitHub reports that
    // inconsistently: 404 when the repo exists but the branch does not, and
    // 409 "Git Repository is empty." when the repo has never been committed
    // to at all. Both mean the same thing here — there is no ref to build on
    // — so both resolve to `null` and let the caller create the first commit.
    if (error instanceof GitHubNotFoundError) return null
    if (error instanceof GitHubConflictError) return null
    throw error
  }
}

interface RawGitCommit {
  tree: { sha: string }
}

/** The tree sha a commit points at — used to get the base tree for the next
 * commit's `base_tree`. */
export async function getCommit(
  token: string,
  owner: string,
  repo: string,
  sha: string,
): Promise<{ treeSha: string }> {
  const response = await githubRequest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits/${encodeURIComponent(sha)}`,
    token,
  )
  const raw = (await response.json()) as RawGitCommit
  return { treeSha: raw.tree.sha }
}

interface RawGitBlob {
  sha: string
}

/** Creates a blob from UTF-8 text (via `utf8ToBase64` — the same
 * correctness-critical encoding `getFileContent`/the old Contents-API write
 * path used, unconditionally reused here) and returns its sha, ready to be
 * referenced by path in `createTree`. */
/**
 * Creates a single file through the Contents API, which — unlike the git data
 * endpoints — works against a repository that has no commits at all.
 *
 * This exists solely to bootstrap an empty repository. GitHub rejects
 * `POST /git/blobs` with 409 "Git Repository is empty." until a first commit
 * exists, so the blob/tree/commit/ref sequence the normal push uses cannot
 * create it. One Contents write makes the initial commit and the branch, and
 * every push after that takes the batched git data path.
 *
 * No `sha` is sent, which makes this create-only: GitHub rejects it with 422
 * if the path already exists, rather than overwriting a file this app never
 * read.
 */
export async function createFileViaContents(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  path: string,
  content: string,
  message: string,
): Promise<void> {
  const segments = path.split('/').map((segment) => encodeURIComponent(segment))
  await githubRequest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${segments.join('/')}`,
    token,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        content: utf8ToBase64(content),
        branch,
      }),
    },
  )
}

export async function createBlob(
  token: string,
  owner: string,
  repo: string,
  content: string,
): Promise<{ sha: string }> {
  const response = await githubRequest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs`,
    token,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: utf8ToBase64(content), encoding: 'base64' }),
    },
  )
  const raw = (await response.json()) as RawGitBlob
  return { sha: raw.sha }
}

export interface TreeEntryInput {
  path: string
  sha: string
}

interface RawGitTree {
  sha: string
}

/**
 * Creates a new tree containing exactly the given (changed) blob entries,
 * layered on top of `baseTreeSha` via `base_tree` — every path from the base
 * tree that isn't mentioned in `entries` is carried over unchanged, and
 * every path that IS mentioned is added or overwritten. `baseTreeSha: null`
 * builds a tree from scratch (the empty-repo initial-commit case — there is
 * no base to layer on).
 */
export async function createTree(
  token: string,
  owner: string,
  repo: string,
  baseTreeSha: string | null,
  entries: TreeEntryInput[],
): Promise<{ sha: string }> {
  const body: {
    base_tree?: string
    tree: { path: string; mode: string; type: string; sha: string }[]
  } = {
    tree: entries.map((entry) => ({
      path: entry.path,
      mode: '100644',
      type: 'blob',
      sha: entry.sha,
    })),
  }
  if (baseTreeSha !== null) {
    body.base_tree = baseTreeSha
  }
  const response = await githubRequest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees`,
    token,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  const raw = (await response.json()) as RawGitTree
  return { sha: raw.sha }
}

interface RawGitCommitResult {
  sha: string
}

/** Creates a commit object pointing at `treeSha` with the given `parents`
 * (empty for the very first commit of an empty repo). Does not move any ref
 * — that's `updateRef`/`createRef`, called separately once this succeeds. */
export async function createCommit(
  token: string,
  owner: string,
  repo: string,
  message: string,
  treeSha: string,
  parents: string[],
): Promise<{ sha: string }> {
  const response = await githubRequest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits`,
    token,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, tree: treeSha, parents }),
    },
  )
  const raw = (await response.json()) as RawGitCommitResult
  return { sha: raw.sha }
}

/** Creates a brand-new branch ref pointing at `sha` — only used for the
 * empty-repo initial commit, where the branch doesn't exist yet for
 * `updateRef` to move. */
export async function createRef(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  sha: string,
): Promise<void> {
  await githubRequest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`,
    token,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
    },
  )
}

/**
 * Moves an existing branch ref to `sha` — always non-force (`force: false`),
 * so GitHub itself refuses a non-fast-forward move rather than this app ever
 * force-pushing over a commit it didn't know about. That refusal (422 or
 * 409, depending on exactly what changed) is translated into
 * `GitHubRefConflictError` specifically, distinct from every other 422/409
 * this module can throw, so `model/sync.ts` can catch precisely this case
 * and retry the whole batch against a freshly-fetched base rather than
 * treating it as a generic failure.
 */
export async function updateRef(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  sha: string,
): Promise<void> {
  try {
    await githubRequest(
      // `heads/` is a path separator in this endpoint, not part of the ref
      // name, so only the branch itself is escaped. Encoding the whole string
      // yields `heads%2Fmain`, which GitHub resolves but should not be sent.
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs/heads/${encodeURIComponent(branch)}`,
      token,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sha, force: false }),
      },
    )
  } catch (error) {
    if (error instanceof GitHubUnprocessableError || error instanceof GitHubConflictError) {
      // Both statuses are collapsed into one meaning here, but they are not
      // actually the same thing: 422 in particular is GitHub's answer to
      // several unrelated problems with a ref update, only one of which is a
      // non-fast-forward. Carrying the original message through keeps a
      // genuinely different failure from being permanently disguised as a
      // moved branch — which is only diagnosable if the wording survives.
      throw new GitHubRefConflictError(
        `Could not move the branch to the new commit — ${error.message}`,
      )
    }
    throw error
  }
}

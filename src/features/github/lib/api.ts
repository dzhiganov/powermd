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

/** `fetch` itself threw — offline, DNS failure, CORS preflight failure, etc.
 * (as opposed to the server returning an error status). */
export class GitHubNetworkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitHubNetworkError'
  }
}

// --- Core request ---------------------------------------------------------

async function githubRequest(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<Response> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
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
    throw new GitHubConflictError('The file changed on GitHub since it was opened.')
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

interface RawCommitResult {
  content: { sha: string }
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

/** Fetches a repo's full recursive git tree at a branch. `truncated` is
 * surfaced so the UI can say "showing a partial file list" rather than
 * silently missing files. */
export async function getTree(
  token: string,
  owner: string,
  repo: string,
  branch: string,
): Promise<{ entries: GitHubTreeEntry[]; truncated: boolean }> {
  const response = await githubRequest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    token,
  )
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

/**
 * Commits a file back via the Contents API. `sha` is the blob sha the edit
 * was made against — GitHub's optimistic-concurrency token — so a stale
 * write is refused with a 409, surfaced as `GitHubConflictError` and left to
 * propagate for the model layer to resolve (this function does not retry or
 * fall back). Returns the new blob sha.
 */
export async function commitFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  branch: string,
  content: string,
  message: string,
  sha: string,
): Promise<{ sha: string }> {
  const response = await githubRequest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodePath(path)}`,
    token,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: utf8ToBase64(content), sha, branch }),
    },
  )
  const raw = (await response.json()) as RawCommitResult
  return { sha: raw.content.sha }
}

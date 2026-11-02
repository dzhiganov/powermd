import { createHash } from 'node:crypto'

import { test, expect, type Page, type Route } from '@playwright/test'

/**
 * GitHub sync end to end, against an in-memory fake of the GitHub REST API
 * and of this app's own `/api/github/*` functions — nothing here reaches the
 * real GitHub. The fake keeps real git semantics where the sync engine
 * depends on them: content-addressed trees (so an unchanged tree has the
 * same sha), `base_tree` layering with `sha: null` removals, and a ref
 * update that is rejected unless it is a fast forward.
 *
 * Needs a dev server with `VITE_GITHUB_APP_CLIENT_ID` set, which the
 * Playwright config passes when it starts one.
 */

test.use({ serviceWorkers: 'block' })

const OWNER = 'alice'
const REPO = 'notes'

function sha(value: unknown): string {
  return createHash('sha1').update(JSON.stringify(value)).digest('hex')
}

interface Commit {
  sha: string
  tree: string
  parents: string[]
  message: string
}

class FakeGitHub {
  validToken = 'ghu_valid'
  blobs = new Map<string, string>()
  trees = new Map<string, Map<string, string>>()
  commits = new Map<string, Commit>()
  head: string
  /** Every commit that moved the branch, oldest first. */
  log: Commit[] = []

  constructor(files: Record<string, string>) {
    const tree = this.storeTree(
      new Map(Object.entries(files).map(([path, content]) => [path, this.storeBlob(content)])),
    )
    const root = { sha: sha(['root', tree]), tree, parents: [], message: 'Initial commit' }
    this.commits.set(root.sha, root)
    this.head = root.sha
  }

  storeBlob(content: string): string {
    const id = sha(['blob', content])
    this.blobs.set(id, content)
    return id
  }

  storeTree(entries: Map<string, string>): string {
    const id = sha([...entries].sort(([a], [b]) => a.localeCompare(b)))
    this.trees.set(id, entries)
    return id
  }

  /** The branch's files as `{ path: content }`. */
  files(): Record<string, string> {
    const tree = this.trees.get((this.commits.get(this.head) as Commit).tree) as Map<string, string>
    return Object.fromEntries([...tree].map(([path, blob]) => [path, this.blobs.get(blob) ?? '']))
  }

  handle(method: string, path: string, body: unknown): { status: number; json?: unknown } {
    const repo = `/repos/${OWNER}/${REPO}`
    if (method === 'GET' && path === '/user') return { status: 200, json: { login: OWNER } }
    if (method === 'GET' && path.startsWith('/user/installations/1/repositories')) {
      return {
        status: 200,
        json: {
          repositories: [
            {
              id: 1,
              name: REPO,
              full_name: `${OWNER}/${REPO}`,
              owner: { login: OWNER },
              default_branch: 'main',
              private: true,
            },
          ],
        },
      }
    }
    if (method === 'GET' && path.startsWith('/user/installations')) {
      return { status: 200, json: { installations: [{ id: 1 }] } }
    }
    if (method === 'GET' && path.startsWith(`${repo}/branches`)) {
      return { status: 200, json: [{ name: 'main' }] }
    }
    if (method === 'GET' && path === `${repo}/git/ref/heads/main`) {
      return { status: 200, json: { object: { sha: this.head } } }
    }
    const commitMatch = new RegExp(`^${repo}/git/commits/(\\w+)$`).exec(path)
    if (method === 'GET' && commitMatch !== null) {
      const commit = this.commits.get(commitMatch[1])
      return commit === undefined
        ? { status: 404, json: { message: 'Not Found' } }
        : { status: 200, json: { tree: { sha: commit.tree } } }
    }
    const treeMatch = new RegExp(`^${repo}/git/trees/([^?]+)`).exec(path)
    if (method === 'GET' && treeMatch !== null) {
      const ref = treeMatch[1]
      const treeSha = ref === 'main' ? (this.commits.get(this.head) as Commit).tree : ref
      const tree = this.trees.get(treeSha) ?? new Map<string, string>()
      return {
        status: 200,
        json: {
          truncated: false,
          tree: [...tree].map(([entryPath, blob]) => ({
            path: entryPath,
            type: 'blob',
            sha: blob,
          })),
        },
      }
    }
    const contentsMatch = new RegExp(`^${repo}/contents/([^?]+)`).exec(path)
    if (method === 'GET' && contentsMatch !== null) {
      const filePath = decodeURIComponent(contentsMatch[1])
      const content = this.files()[filePath]
      if (content === undefined) return { status: 404, json: { message: 'Not Found' } }
      return {
        status: 200,
        json: {
          sha: sha(['blob', content]),
          size: content.length,
          content: Buffer.from(content, 'utf8').toString('base64'),
        },
      }
    }
    if (method === 'POST' && path === `${repo}/git/blobs`) {
      const { content } = body as { content: string }
      return {
        status: 201,
        json: { sha: this.storeBlob(Buffer.from(content, 'base64').toString('utf8')) },
      }
    }
    if (method === 'POST' && path === `${repo}/git/trees`) {
      const { base_tree: base, tree } = body as {
        base_tree?: string
        tree: { path: string; sha: string | null }[]
      }
      const entries = new Map(base === undefined ? [] : this.trees.get(base))
      for (const entry of tree) {
        if (entry.sha === null) {
          if (!entries.has(entry.path))
            return { status: 422, json: { message: 'tree.sha is invalid' } }
          entries.delete(entry.path)
        } else {
          entries.set(entry.path, entry.sha)
        }
      }
      return { status: 201, json: { sha: this.storeTree(entries) } }
    }
    if (method === 'POST' && path === `${repo}/git/commits`) {
      const { message, tree, parents } = body as {
        message: string
        tree: string
        parents: string[]
      }
      const commit = {
        sha: sha(['commit', message, tree, parents, this.commits.size]),
        tree,
        parents,
        message,
      }
      this.commits.set(commit.sha, commit)
      return { status: 201, json: { sha: commit.sha } }
    }
    if (method === 'PATCH' && path === `${repo}/git/refs/heads/main`) {
      const commit = this.commits.get((body as { sha: string }).sha)
      if (commit === undefined || commit.parents[0] !== this.head) {
        return { status: 422, json: { message: 'Update is not a fast forward' } }
      }
      this.head = commit.sha
      this.log.push(commit)
      return { status: 200, json: { object: { sha: commit.sha } } }
    }
    return { status: 404, json: { message: `Fake GitHub has no ${method} ${path}` } }
  }
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, x-github-api-version, accept',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
}

interface AppServer {
  refreshes: number
  revokes: number
}

async function mockGitHub(page: Page, github: FakeGitHub): Promise<AppServer> {
  const server: AppServer = { refreshes: 0, revokes: 0 }

  await page.route('https://api.github.com/**', async (route: Route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS })
      return
    }
    if (request.headers().authorization !== `Bearer ${github.validToken}`) {
      await route.fulfill({ status: 401, headers: CORS, json: { message: 'Bad credentials' } })
      return
    }
    const url = new URL(request.url())
    const result = github.handle(
      request.method(),
      `${url.pathname}${url.search}`,
      request.postData() === null ? null : request.postDataJSON(),
    )
    await route.fulfill({ status: result.status, headers: CORS, json: result.json })
  })

  // GitHub's authorize page: approve at once and send the browser back to
  // the app's callback, carrying the state the app generated.
  await page.route('https://github.com/login/oauth/authorize**', async (route) => {
    const url = new URL(route.request().url())
    const callback = new URL(url.searchParams.get('redirect_uri') as string)
    callback.searchParams.set('code', 'code-from-github')
    callback.searchParams.set('state', url.searchParams.get('state') as string)
    await route.fulfill({ status: 302, headers: { location: callback.toString() } })
  })

  const tokenResult = {
    accessToken: github.validToken,
    tokenType: 'bearer',
    expiresAt: new Date(Date.now() + 8 * 3600_000).toISOString(),
    refreshToken: 'ghr_refresh',
    refreshTokenExpiresAt: new Date(Date.now() + 180 * 86400_000).toISOString(),
  }
  await page.route('**/api/github/token', (route) => route.fulfill({ json: tokenResult }))
  await page.route('**/api/github/refresh', (route) => {
    server.refreshes += 1
    return route.fulfill({ json: tokenResult })
  })
  await page.route('**/api/github/revoke', (route) => {
    server.revokes += 1
    return route.fulfill({ json: { revoked: true } })
  })
  return server
}

async function openSyncSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'Sync' }).click()
}

async function closeSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Close settings' }).click()
}

async function syncNow(page: Page, github: FakeGitHub, expectedCommits: number): Promise<void> {
  await openSyncSettings(page)
  await page.getByRole('button', { name: 'Sync now' }).click()
  await expect.poll(() => github.log.length).toBe(expectedCommits)
  await expect(page.getByText(/^Last synced/)).toBeVisible()
  // A push that should not happen would land well within this — the fake
  // answers at once — so the count is checked again once it would have.
  await page.waitForTimeout(500)
  expect(github.log.length).toBe(expectedCommits)
  await closeSettings(page)
}

test('sign in, connect, import, push, rename and disconnect', async ({ page }) => {
  const github = new FakeGitHub({ 'existing.md': '# Already on GitHub\n' })
  const server = await mockGitHub(page, github)

  await page.goto('/')
  await page.locator('.cm-content').waitFor()

  // --- Sign in with GitHub (the App's OAuth flow).
  await openSyncSettings(page)
  const signIn = page.getByRole('button', { name: 'Sign in with GitHub' })
  await expect(signIn, 'the dev server needs VITE_GITHUB_APP_CLIENT_ID').toBeVisible()
  await signIn.click()
  await page.waitForURL((url) => url.pathname === '/')
  await page.locator('.cm-content').waitFor()

  // --- Pick the repository and connect.
  await openSyncSettings(page)
  await expect(page.getByText(`Connected as ${OWNER}`)).toBeVisible()
  await page.getByRole('combobox', { name: 'Repository' }).selectOption(`${OWNER}/${REPO}`)
  await page.getByRole('button', { name: 'Connect', exact: true }).click()

  // The existing file is imported, and the first push adds the local
  // welcome document without touching it.
  await expect.poll(() => github.log.length).toBe(1)
  expect(github.files()['existing.md']).toBe('# Already on GitHub\n')
  expect(Object.keys(github.files())).toHaveLength(2)
  await closeSettings(page)
  await expect(page.getByText('existing', { exact: true })).toBeVisible()

  // --- A new document is not pushed while it is blank...
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New file' }).click()
  await syncNow(page, github, 1)

  // ...and goes up once it has content.
  await page.locator('.cm-content').fill('# Architecture\n\nMono or poly.')
  await syncNow(page, github, 2)
  expect(github.files()['untitled.md']).toBe('# Architecture\n\nMono or poly.')

  // --- Renaming it moves the file, in one commit, leaving no copy behind.
  await page.getByRole('button', { name: 'Rename document' }).click()
  const title = page.getByRole('textbox', { name: 'Document title' })
  await title.fill('Architecture')
  await title.press('Enter')
  await syncNow(page, github, 3)
  expect(github.log[2].message).toBe('Rename untitled.md to architecture.md')
  expect(github.files()['architecture.md']).toBe('# Architecture\n\nMono or poly.')
  expect(github.files()['untitled.md']).toBeUndefined()

  // --- Nothing changed: no empty commit.
  await syncNow(page, github, 3)

  // --- Disconnect revokes the authorization and forgets the token.
  await openSyncSettings(page)
  await page.getByRole('button', { name: 'Remove token, stop syncing, and disconnect' }).click()
  await expect(page.getByRole('button', { name: 'Sign in with GitHub' })).toBeVisible()
  await expect.poll(() => server.revokes).toBe(1)
  expect(await page.evaluate(() => localStorage.getItem('markdown-editor:github-token'))).toBeNull()
})

test('an access token that expired since the last visit is refreshed on load', async ({ page }) => {
  const github = new FakeGitHub({})
  const server = await mockGitHub(page, github)
  await page.addInitScript(() => {
    localStorage.setItem('markdown-editor:github-token', 'ghu_expired')
    localStorage.setItem('markdown-editor:github-credential-kind', 'app')
    localStorage.setItem(
      'markdown-editor:github-app-auth',
      JSON.stringify({ refreshToken: 'ghr_refresh', expiresAt: 0, refreshTokenExpiresAt: null }),
    )
    localStorage.setItem(
      'markdown-editor:github-sync-config',
      JSON.stringify({ owner: 'alice', repo: 'notes', branch: 'main', subfolder: '' }),
    )
  })

  await page.goto('/')
  await page.locator('.cm-content').waitFor()
  await openSyncSettings(page)
  await expect(page.getByText(`Connected as ${OWNER}`)).toBeVisible()
  expect(server.refreshes).toBe(1)
  expect(await page.evaluate(() => localStorage.getItem('markdown-editor:github-token'))).toBe(
    github.validToken,
  )
})

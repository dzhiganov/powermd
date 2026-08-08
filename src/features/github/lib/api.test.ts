import { afterEach, describe, expect, it, vi } from 'vitest'

import { listAllAppRepos, GitHubNotFoundError } from './api'

/**
 * Focused on `listAllAppRepos` — the GitHub-App-token repository listing
 * path added alongside `listAllRepos` (untouched by this change; not
 * re-tested here). Every response shape below is GitHub's real documented
 * shape for these endpoints as of this app's REST API version
 * (`2022-11-28`):
 *
 *   GET /user/installations
 *     -> { installations: [{ id, ... }], total_count }
 *   GET /user/installations/{installation_id}/repositories
 *     -> { repositories: [{ id, name, full_name, owner: { login }, ... }], total_count }
 *
 * This is mock-verified against that documented shape, not against a real
 * GitHub App — there is no App/token available in this environment. See the
 * task report for what remains unverifiable without one.
 */

function rawRepo(id: number, name: string, owner = 'octo') {
  return {
    id,
    name,
    full_name: `${owner}/${name}`,
    owner: { login: owner },
    default_branch: 'main',
    private: true,
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('listAllAppRepos', () => {
  it('zero installations is not an error — resolves to an empty list', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      expect(url.pathname).toBe('/user/installations')
      return jsonResponse({ installations: [], total_count: 0 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(listAllAppRepos('token')).resolves.toEqual([])
    // Never asked for a single installation's repos — there were none.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('paginates the installations list across pages', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ id: i + 1 }))
    const page2 = [{ id: 101 }]

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === '/user/installations') {
        const page = url.searchParams.get('page')
        if (page === '1') return jsonResponse({ installations: page1, total_count: 101 })
        if (page === '2') return jsonResponse({ installations: page2, total_count: 101 })
        throw new Error(`unexpected installations page ${String(page)}`)
      }
      // Every installation reports no repositories — this test only
      // exercises pagination of the installations list itself.
      return jsonResponse({ repositories: [], total_count: 0 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await listAllAppRepos('token')

    const installationsCalls = fetchMock.mock.calls.filter(
      ([input]) => new URL(String(input)).pathname === '/user/installations',
    )
    expect(installationsCalls).toHaveLength(2)

    // One repositories call per installation across both pages: 101 total.
    const repoCalls = fetchMock.mock.calls.filter(([input]) =>
      new URL(String(input)).pathname.endsWith('/repositories'),
    )
    expect(repoCalls).toHaveLength(101)
  })

  it("paginates a single installation's repositories across pages", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => rawRepo(i + 1, `repo-${i + 1}`))
    const page2 = [rawRepo(101, 'repo-101')]

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === '/user/installations') {
        return jsonResponse({ installations: [{ id: 7 }], total_count: 1 })
      }
      expect(url.pathname).toBe('/user/installations/7/repositories')
      const page = url.searchParams.get('page')
      if (page === '1') return jsonResponse({ repositories: page1, total_count: 101 })
      if (page === '2') return jsonResponse({ repositories: page2, total_count: 101 })
      throw new Error(`unexpected repositories page ${String(page)}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const repos = await listAllAppRepos('token')
    expect(repos).toHaveLength(101)
    expect(repos.map((r) => r.fullName)).toContain('octo/repo-101')
  })

  it('deduplicates a repository reachable through more than one installation', async () => {
    const shared = rawRepo(42, 'shared-repo')
    const onlyInFirst = rawRepo(1, 'only-in-first')
    const onlyInSecond = rawRepo(2, 'only-in-second')

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === '/user/installations') {
        return jsonResponse({ installations: [{ id: 10 }, { id: 20 }], total_count: 2 })
      }
      if (url.pathname === '/user/installations/10/repositories') {
        return jsonResponse({ repositories: [shared, onlyInFirst], total_count: 2 })
      }
      if (url.pathname === '/user/installations/20/repositories') {
        return jsonResponse({ repositories: [shared, onlyInSecond], total_count: 2 })
      }
      throw new Error(`unexpected path ${url.pathname}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const repos = await listAllAppRepos('token')
    // 3 distinct repos, not 4 — the shared one counted once.
    expect(repos).toHaveLength(3)
    expect(repos.map((r) => r.id).sort((a, b) => a - b)).toEqual([1, 2, 42])
  })

  it('sorts the merged, deduplicated result by full name', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === '/user/installations') {
        return jsonResponse({ installations: [{ id: 1 }], total_count: 1 })
      }
      return jsonResponse({
        repositories: [rawRepo(3, 'zebra'), rawRepo(1, 'alpha'), rawRepo(2, 'mid')],
        total_count: 3,
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const repos = await listAllAppRepos('token')
    expect(repos.map((r) => r.name)).toEqual(['alpha', 'mid', 'zebra'])
  })

  it('propagates a 404 from the installations list as GitHubNotFoundError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })),
    )

    await expect(listAllAppRepos('token')).rejects.toBeInstanceOf(GitHubNotFoundError)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Focused on `listReposForActiveCredential` — the branch that decides
 * whether repository listing goes through `/user/repos` (a personal access
 * token) or the installations endpoints (a GitHub App token), based on the
 * kind declared in `lib/credentialKind.ts`. `../lib/api` is mocked so this
 * only tests which lister gets picked, not what either one does internally
 * (that's `lib/api.test.ts`'s job for the App path; the PAT path,
 * `listAllRepos`, is untouched by this change).
 *
 * Every test dynamically re-imports `./repos` after `vi.resetModules()`,
 * same pattern as `connection.test.ts`, so a stubbed in-memory
 * `localStorage` backs `lib/credentialKind.ts` for real rather than being
 * mocked away.
 */

vi.mock('../lib/api', () => ({
  listAllRepos: vi.fn(async () => [{ id: 1, marker: 'pat-path' }]),
  listAllAppRepos: vi.fn(async () => [{ id: 2, marker: 'app-path' }]),
}))

function createFakeStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size
    },
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('localStorage', createFakeStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('listReposForActiveCredential', () => {
  it('uses the PAT path when no credential kind was ever declared (pre-existing connections)', async () => {
    const { listReposForActiveCredential } = await import('./repos')
    const { listAllRepos, listAllAppRepos } = await import('../lib/api')

    const result = await listReposForActiveCredential('token')

    expect(listAllRepos).toHaveBeenCalledExactlyOnceWith('token')
    expect(listAllAppRepos).not.toHaveBeenCalled()
    expect(result).toEqual([{ id: 1, marker: 'pat-path' }])
  })

  it('uses the PAT path when the declared kind is "pat"', async () => {
    const { storeCredentialKind } = await import('../lib/credentialKind')
    storeCredentialKind('pat')

    const { listReposForActiveCredential } = await import('./repos')
    const { listAllRepos, listAllAppRepos } = await import('../lib/api')

    await listReposForActiveCredential('token')

    expect(listAllRepos).toHaveBeenCalledExactlyOnceWith('token')
    expect(listAllAppRepos).not.toHaveBeenCalled()
  })

  it('uses the App-installation path when the declared kind is "app"', async () => {
    const { storeCredentialKind } = await import('../lib/credentialKind')
    storeCredentialKind('app')

    const { listReposForActiveCredential } = await import('./repos')
    const { listAllRepos, listAllAppRepos } = await import('../lib/api')

    const result = await listReposForActiveCredential('token')

    expect(listAllAppRepos).toHaveBeenCalledExactlyOnceWith('token')
    expect(listAllRepos).not.toHaveBeenCalled()
    expect(result).toEqual([{ id: 2, marker: 'app-path' }])
  })
})

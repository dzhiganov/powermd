import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Focused on `callWithToken` — the refresh-on-401 wrapper every
 * network-calling effect in this feature goes through (see its own doc
 * comment in `connection.ts`). `../lib/appApi` (the client for this app's
 * own `/api/github/refresh` serverless function) is the only thing mocked;
 * `../lib/token.ts`/`../lib/appAuth.ts` run for real against a stubbed
 * in-memory `localStorage`, so this also exercises the actual storage
 * round-trip a refresh performs.
 *
 * Every test dynamically re-imports `./connection` after `vi.resetModules()`
 * so the module-level `refreshInFlight` dedup guard and every Effector store
 * start fresh — otherwise a store mutated by one test (e.g.
 * `$connectionStatus` moving to `'reauth-required'`) would leak into the
 * next.
 */

vi.mock('../lib/appApi', () => ({
  refreshAppToken: vi.fn(),
  GitHubAppAuthError: class GitHubAppAuthError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'GitHubAppAuthError'
    }
  },
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
  // `vi.restoreAllMocks()` only touches `vi.spyOn` mocks — `refreshAppToken`
  // is a plain `vi.fn()` from the `vi.mock` factory above, which
  // `resetModules()` does not re-create per test, so its call history would
  // otherwise accumulate across tests in this file. `clearAllMocks()` resets
  // call history (and any `mockResolvedValueOnce`/`mockRejectedValueOnce`
  // queue) for every mock regardless of how it was created.
  vi.clearAllMocks()
})

describe('callWithToken', () => {
  it('runs the operation once and returns its result when nothing fails', async () => {
    const { callWithToken } = await import('./connection')
    const { storeToken } = await import('../lib/token')
    const { refreshAppToken } = await import('../lib/appApi')
    storeToken('good-token')

    const operation = vi.fn(async (token: string) => `ok:${token}`)
    await expect(callWithToken(operation)).resolves.toBe('ok:good-token')
    expect(operation).toHaveBeenCalledTimes(1)
    expect(refreshAppToken).not.toHaveBeenCalled()
  })

  it('throws immediately when there is no active token', async () => {
    const { callWithToken } = await import('./connection')
    await expect(callWithToken(vi.fn())).rejects.toThrow('Not connected to GitHub.')
  })

  it('propagates a non-401 error without attempting a refresh', async () => {
    const { callWithToken } = await import('./connection')
    const { storeToken } = await import('../lib/token')
    const { refreshAppToken } = await import('../lib/appApi')
    storeToken('good-token')

    const operation = vi.fn(async () => {
      throw new Error('network down')
    })
    await expect(callWithToken(operation)).rejects.toThrow('network down')
    expect(refreshAppToken).not.toHaveBeenCalled()
  })

  it('a 401 with nothing to refresh (a PAT connection) surfaces reauth-required without calling refresh', async () => {
    const { callWithToken, $connectionStatus, GitHubReauthRequiredError } =
      await import('./connection')
    const { storeToken, getStoredToken } = await import('../lib/token')
    const { GitHubAuthError } = await import('../lib/api')
    const { refreshAppToken } = await import('../lib/appApi')
    storeToken('pat-token') // no `../lib/appAuth` meta stored — a PAT connection

    const operation = vi.fn(async () => {
      throw new GitHubAuthError('bad credentials')
    })

    await expect(callWithToken(operation)).rejects.toBeInstanceOf(GitHubReauthRequiredError)
    expect(refreshAppToken).not.toHaveBeenCalled()
    expect(operation).toHaveBeenCalledTimes(1)
    expect($connectionStatus.getState()).toBe('reauth-required')
    // The credential is cleared so the UI can't keep presenting it as valid.
    expect(getStoredToken()).toBeNull()
  })

  it('a 401 with a stored refresh token refreshes once and retries successfully', async () => {
    const { callWithToken, $connectionStatus } = await import('./connection')
    const { storeToken, getStoredToken } = await import('../lib/token')
    const { storeAppAuthMeta, getStoredAppAuthMeta } = await import('../lib/appAuth')
    const { GitHubAuthError } = await import('../lib/api')
    const { refreshAppToken } = await import('../lib/appApi')

    storeToken('expired-token')
    storeAppAuthMeta({ refreshToken: 'ghr_old', expiresAt: null, refreshTokenExpiresAt: null })
    vi.mocked(refreshAppToken).mockResolvedValueOnce({
      accessToken: 'fresh-token',
      tokenType: 'bearer',
      expiresAt: null,
      refreshToken: 'ghr_new',
      refreshTokenExpiresAt: null,
    })

    let attempt = 0
    const operation = vi.fn(async (token: string) => {
      attempt += 1
      if (attempt === 1) throw new GitHubAuthError('token expired')
      return `ok:${token}`
    })

    await expect(callWithToken(operation)).resolves.toBe('ok:fresh-token')
    expect(refreshAppToken).toHaveBeenCalledExactlyOnceWith('ghr_old')
    expect(operation).toHaveBeenCalledTimes(2)
    expect(operation).toHaveBeenLastCalledWith('fresh-token')
    expect(getStoredToken()).toBe('fresh-token')
    expect(getStoredAppAuthMeta()?.refreshToken).toBe('ghr_new')
    expect($connectionStatus.getState()).not.toBe('reauth-required')
  })

  it('gives up after one refresh+retry — a second 401 surfaces reauth-required, not a second refresh', async () => {
    const { callWithToken, $connectionStatus, GitHubReauthRequiredError } =
      await import('./connection')
    const { storeToken } = await import('../lib/token')
    const { storeAppAuthMeta } = await import('../lib/appAuth')
    const { GitHubAuthError } = await import('../lib/api')
    const { refreshAppToken } = await import('../lib/appApi')

    storeToken('expired-token')
    storeAppAuthMeta({ refreshToken: 'ghr_old', expiresAt: null, refreshTokenExpiresAt: null })
    vi.mocked(refreshAppToken).mockResolvedValueOnce({
      accessToken: 'still-rejected-token',
      tokenType: 'bearer',
      expiresAt: null,
      refreshToken: null,
      refreshTokenExpiresAt: null,
    })

    const operation = vi.fn(async () => {
      throw new GitHubAuthError('token expired')
    })

    await expect(callWithToken(operation)).rejects.toBeInstanceOf(GitHubReauthRequiredError)
    expect(refreshAppToken).toHaveBeenCalledTimes(1) // exactly one refresh attempt, not a loop
    expect(operation).toHaveBeenCalledTimes(2) // the original attempt + one retry
    expect($connectionStatus.getState()).toBe('reauth-required')
  })

  it('when the refresh call itself fails, surfaces reauth-required without retrying the operation', async () => {
    const { callWithToken, GitHubReauthRequiredError } = await import('./connection')
    const { storeToken } = await import('../lib/token')
    const { storeAppAuthMeta } = await import('../lib/appAuth')
    const { GitHubAuthError } = await import('../lib/api')
    const { refreshAppToken, GitHubAppAuthError } = await import('../lib/appApi')

    storeToken('expired-token')
    storeAppAuthMeta({ refreshToken: 'ghr_old', expiresAt: null, refreshTokenExpiresAt: null })
    vi.mocked(refreshAppToken).mockRejectedValueOnce(
      new GitHubAppAuthError('refresh token expired'),
    )

    const operation = vi.fn(async () => {
      throw new GitHubAuthError('token expired')
    })

    await expect(callWithToken(operation)).rejects.toBeInstanceOf(GitHubReauthRequiredError)
    expect(operation).toHaveBeenCalledTimes(1) // never retried — the refresh itself never succeeded
  })
})

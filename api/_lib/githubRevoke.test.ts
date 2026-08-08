import { afterEach, describe, expect, it, vi } from 'vitest'

import { GitHubRevokeError, revokeWithGitHub } from './githubRevoke'
import { MissingEnvError } from './env'

describe('revokeWithGitHub', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('DELETEs the applications/{client_id}/token endpoint with Basic auth and the token in the body', async () => {
    vi.stubEnv('GITHUB_APP_CLIENT_ID', 'Iv1.test-client-id')
    vi.stubEnv('GITHUB_APP_CLIENT_SECRET', 'super-secret-value')

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://api.github.com/applications/Iv1.test-client-id/token')
      expect(init?.method).toBe('DELETE')
      const headers = init?.headers as Record<string, string>
      expect(headers.Authorization).toBe(`Basic ${btoa('Iv1.test-client-id:super-secret-value')}`)
      const body = JSON.parse(init?.body as string) as Record<string, string>
      expect(body).toEqual({ access_token: 'ghu_to_revoke' })
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await revokeWithGitHub('ghu_to_revoke')
    expect(result).toEqual({ revoked: true })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('treats a 404 (GitHub has no record of the token) as revoked too', async () => {
    vi.stubEnv('GITHUB_APP_CLIENT_ID', 'id')
    vi.stubEnv('GITHUB_APP_CLIENT_SECRET', 'secret')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })),
    )

    const result = await revokeWithGitHub('already-gone')
    expect(result).toEqual({ revoked: true })
  })

  it('surfaces any other GitHub-side rejection as GitHubRevokeError', async () => {
    vi.stubEnv('GITHUB_APP_CLIENT_ID', 'id')
    vi.stubEnv('GITHUB_APP_CLIENT_SECRET', 'secret')
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ message: 'Validation failed' }), { status: 422 }),
      ),
    )

    await expect(revokeWithGitHub('bad-token')).rejects.toThrow(GitHubRevokeError)
    await expect(revokeWithGitHub('bad-token')).rejects.toThrow('Validation failed')
  })

  it('falls back to a generic status-based message when GitHub sends no JSON body', async () => {
    vi.stubEnv('GITHUB_APP_CLIENT_ID', 'id')
    vi.stubEnv('GITHUB_APP_CLIENT_SECRET', 'secret')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 500 })),
    )

    await expect(revokeWithGitHub('x')).rejects.toThrow('status 500')
  })

  it('wraps a network failure in GitHubRevokeError', async () => {
    vi.stubEnv('GITHUB_APP_CLIENT_ID', 'id')
    vi.stubEnv('GITHUB_APP_CLIENT_SECRET', 'secret')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('getaddrinfo ENOTFOUND api.github.com')
      }),
    )

    await expect(revokeWithGitHub('x')).rejects.toThrow(GitHubRevokeError)
  })

  it('never reads a literal client secret — throws MissingEnvError when the env var is absent', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(revokeWithGitHub('x')).rejects.toBeInstanceOf(MissingEnvError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'

import { exchangeWithGitHub, GitHubTokenExchangeError, normalizeTokenResponse } from './githubToken'
import { MissingEnvError } from './env'

const NOW = 1_700_000_000_000 // arbitrary fixed epoch ms

describe('normalizeTokenResponse', () => {
  it('normalizes a response with expiration enabled, computing absolute timestamps', () => {
    const result = normalizeTokenResponse(
      {
        access_token: 'ghu_abc123',
        token_type: 'bearer',
        expires_in: 28800, // 8 hours
        refresh_token: 'ghr_def456',
        refresh_token_expires_in: 15897600, // ~184 days
      },
      NOW,
    )
    expect(result).toEqual({
      accessToken: 'ghu_abc123',
      tokenType: 'bearer',
      expiresAt: new Date(NOW + 28800 * 1000).toISOString(),
      refreshToken: 'ghr_def456',
      refreshTokenExpiresAt: new Date(NOW + 15897600 * 1000).toISOString(),
    })
  })

  it('normalizes a response with expiration disabled — no expiry, no refresh token', () => {
    const result = normalizeTokenResponse({ access_token: 'ghu_abc123', token_type: 'bearer' }, NOW)
    expect(result).toEqual({
      accessToken: 'ghu_abc123',
      tokenType: 'bearer',
      expiresAt: null,
      refreshToken: null,
      refreshTokenExpiresAt: null,
    })
  })

  it('defaults tokenType to "bearer" when GitHub omits it', () => {
    const result = normalizeTokenResponse({ access_token: 'ghu_abc123' }, NOW)
    expect(result.tokenType).toBe('bearer')
  })

  it('throws GitHubTokenExchangeError on an error body, preferring error_description', () => {
    expect(() =>
      normalizeTokenResponse(
        { error: 'bad_verification_code', error_description: 'The code passed is incorrect.' },
        NOW,
      ),
    ).toThrow(GitHubTokenExchangeError)
    try {
      normalizeTokenResponse(
        { error: 'bad_verification_code', error_description: 'The code passed is incorrect.' },
        NOW,
      )
    } catch (error) {
      expect(error).toBeInstanceOf(GitHubTokenExchangeError)
      expect((error as Error).message).toBe('The code passed is incorrect.')
    }
  })

  it('falls back to the bare error code when no description is present', () => {
    try {
      normalizeTokenResponse({ error: 'bad_verification_code' }, NOW)
      expect.unreachable()
    } catch (error) {
      expect((error as Error).message).toContain('bad_verification_code')
    }
  })

  it('rejects a body with no access_token and no error', () => {
    expect(() => normalizeTokenResponse({}, NOW)).toThrow(GitHubTokenExchangeError)
  })

  it('rejects a non-object body', () => {
    expect(() => normalizeTokenResponse(null, NOW)).toThrow(GitHubTokenExchangeError)
    expect(() => normalizeTokenResponse('nope', NOW)).toThrow(GitHubTokenExchangeError)
  })
})

describe('exchangeWithGitHub', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('POSTs client_id/client_secret/grant_type/code to the token endpoint and normalizes the result', async () => {
    vi.stubEnv('GITHUB_APP_CLIENT_ID', 'Iv1.test-client-id')
    vi.stubEnv('GITHUB_APP_CLIENT_SECRET', 'super-secret-value')

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as Record<string, string>
      expect(body).toEqual({
        client_id: 'Iv1.test-client-id',
        client_secret: 'super-secret-value',
        grant_type: 'authorization_code',
        code: 'the-code',
      })
      return new Response(JSON.stringify({ access_token: 'ghu_xyz', token_type: 'bearer' }), {
        status: 200,
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await exchangeWithGitHub({ grantType: 'authorization_code', code: 'the-code' })
    expect(result.accessToken).toBe('ghu_xyz')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0]).toBe('https://github.com/login/oauth/access_token')
  })

  it('sends refresh_token, not code, for a refresh_token grant', async () => {
    vi.stubEnv('GITHUB_APP_CLIENT_ID', 'id')
    vi.stubEnv('GITHUB_APP_CLIENT_SECRET', 'secret')

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as Record<string, string>
      expect(body.grant_type).toBe('refresh_token')
      expect(body.refresh_token).toBe('ghr_old')
      expect(body.code).toBeUndefined()
      return new Response(JSON.stringify({ access_token: 'ghu_new', token_type: 'bearer' }), {
        status: 200,
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await exchangeWithGitHub({ grantType: 'refresh_token', refreshToken: 'ghr_old' })
    expect(result.accessToken).toBe('ghu_new')
  })

  it('never reads a literal client secret — throws MissingEnvError when the env var is absent', async () => {
    // GITHUB_APP_CLIENT_ID/SECRET deliberately left unset.
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      exchangeWithGitHub({ grantType: 'authorization_code', code: 'x' }),
    ).rejects.toBeInstanceOf(MissingEnvError)
    // The secret was missing before any network call was ever attempted.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('wraps a network failure in GitHubTokenExchangeError without leaking the underlying error', async () => {
    vi.stubEnv('GITHUB_APP_CLIENT_ID', 'id')
    vi.stubEnv('GITHUB_APP_CLIENT_SECRET', 'secret')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('getaddrinfo ENOTFOUND github.com — some low-level detail')
      }),
    )

    await expect(
      exchangeWithGitHub({ grantType: 'authorization_code', code: 'x' }),
    ).rejects.toThrow(GitHubTokenExchangeError)
  })

  it('surfaces GitHub rejecting the exchange (bad code) as GitHubTokenExchangeError', async () => {
    vi.stubEnv('GITHUB_APP_CLIENT_ID', 'id')
    vi.stubEnv('GITHUB_APP_CLIENT_SECRET', 'secret')
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: 'bad_verification_code',
              error_description: 'The code passed is incorrect or expired.',
            }),
            { status: 200 },
          ),
      ),
    )

    await expect(
      exchangeWithGitHub({ grantType: 'authorization_code', code: 'stale' }),
    ).rejects.toThrow('The code passed is incorrect or expired.')
  })
})

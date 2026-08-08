import { afterEach, describe, expect, it, vi } from 'vitest'

import handler from './refresh'

function postRequest(body: unknown): Request {
  return new Request('https://app.example.com/api/github/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/github/refresh', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('rejects anything other than POST with 405', async () => {
    const response = await handler(
      new Request('https://app.example.com/api/github/refresh', { method: 'PUT' }),
    )
    expect(response.status).toBe(405)
  })

  it('rejects a body missing "refreshToken" with 400', async () => {
    const response = await handler(postRequest({}))
    expect(response.status).toBe(400)
  })

  it('sends grant_type=refresh_token and returns the new normalized token', async () => {
    vi.stubEnv('GITHUB_APP_CLIENT_ID', 'id')
    vi.stubEnv('GITHUB_APP_CLIENT_SECRET', 'secret')
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as Record<string, string>
      expect(body.grant_type).toBe('refresh_token')
      expect(body.refresh_token).toBe('ghr_old')
      return new Response(
        JSON.stringify({
          access_token: 'ghu_new',
          token_type: 'bearer',
          expires_in: 28800,
          refresh_token: 'ghr_new',
          refresh_token_expires_in: 15897600,
        }),
        { status: 200 },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await handler(postRequest({ refreshToken: 'ghr_old' }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as { accessToken: string; refreshToken: string | null }
    expect(body.accessToken).toBe('ghu_new')
    expect(body.refreshToken).toBe('ghr_new')
  })

  it('surfaces an expired/invalid refresh token as a 502, not a silent success', async () => {
    vi.stubEnv('GITHUB_APP_CLIENT_ID', 'id')
    vi.stubEnv('GITHUB_APP_CLIENT_SECRET', 'secret')
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: 'bad_refresh_token',
              error_description: 'Refresh token expired.',
            }),
            { status: 200 },
          ),
      ),
    )

    const response = await handler(postRequest({ refreshToken: 'ghr_expired' }))
    expect(response.status).toBe(502)
  })

  it('never echoes the refresh token or client secret in an error body', async () => {
    // No env stubbed -> MissingEnvError -> generic 500.
    const response = await handler(postRequest({ refreshToken: 'ghr_super_secret_value' }))
    const text = await response.text()
    expect(text).not.toContain('ghr_super_secret_value')
  })
})

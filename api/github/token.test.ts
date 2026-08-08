import { afterEach, describe, expect, it, vi } from 'vitest'

import handler from './token'

function postRequest(body: unknown): Request {
  return new Request('https://app.example.com/api/github/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/github/token', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('rejects anything other than POST with 405, without touching GitHub', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await handler(
      new Request('https://app.example.com/api/github/token', { method: 'GET' }),
    )
    expect(response.status).toBe(405)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a body missing "code" with 400', async () => {
    vi.stubEnv('GITHUB_APP_CLIENT_ID', 'id')
    vi.stubEnv('GITHUB_APP_CLIENT_SECRET', 'secret')

    const response = await handler(postRequest({}))
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('invalid_request')
  })

  it('rejects a non-JSON body with 400', async () => {
    const response = await handler(
      new Request('https://app.example.com/api/github/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      }),
    )
    expect(response.status).toBe(400)
  })

  it('exchanges a valid code against a stubbed GitHub and returns the normalized result', async () => {
    vi.stubEnv('GITHUB_APP_CLIENT_ID', 'id')
    vi.stubEnv('GITHUB_APP_CLIENT_SECRET', 'secret')
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              access_token: 'ghu_abc',
              token_type: 'bearer',
              expires_in: 28800,
              refresh_token: 'ghr_def',
              refresh_token_expires_in: 15897600,
            }),
            { status: 200 },
          ),
      ),
    )

    const response = await handler(postRequest({ code: 'valid-code' }))
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const body = (await response.json()) as { accessToken: string; refreshToken: string | null }
    expect(body.accessToken).toBe('ghu_abc')
    expect(body.refreshToken).toBe('ghr_def')
  })

  it('never leaks the client secret in a 500 when the server is misconfigured', async () => {
    // No GITHUB_APP_CLIENT_ID/SECRET stubbed — simulates a deployment
    // missing the env var.
    const response = await handler(postRequest({ code: 'valid-code' }))
    expect(response.status).toBe(500)
    const text = await response.text()
    expect(text).not.toContain('GITHUB_APP_CLIENT_SECRET')
    expect(text).not.toContain('secret')
    const body = JSON.parse(text) as { error: string; message: string }
    expect(body.error).toBe('server_misconfigured')
  })

  it('surfaces a GitHub-side rejection (bad code) as a 502, not a 200', async () => {
    vi.stubEnv('GITHUB_APP_CLIENT_ID', 'id')
    vi.stubEnv('GITHUB_APP_CLIENT_SECRET', 'secret')
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: 'bad_verification_code', error_description: 'Expired code.' }),
            { status: 200 },
          ),
      ),
    )

    const response = await handler(postRequest({ code: 'stale-code' }))
    expect(response.status).toBe(502)
  })
})

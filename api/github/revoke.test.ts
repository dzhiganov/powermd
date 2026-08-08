import { afterEach, describe, expect, it, vi } from 'vitest'

import handler from './revoke'

function postRequest(body: unknown): Request {
  return new Request('https://app.example.com/api/github/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/github/revoke', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('rejects anything other than POST with 405, without touching GitHub', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await handler(
      new Request('https://app.example.com/api/github/revoke', { method: 'GET' }),
    )
    expect(response.status).toBe(405)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a body missing "token" with 400', async () => {
    vi.stubEnv('GITHUB_APP_CLIENT_ID', 'id')
    vi.stubEnv('GITHUB_APP_CLIENT_SECRET', 'secret')

    const response = await handler(postRequest({}))
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('invalid_request')
  })

  it('rejects a non-string "token" with 400', async () => {
    const response = await handler(postRequest({ token: 42 }))
    expect(response.status).toBe(400)
  })

  it('rejects a non-JSON body with 400', async () => {
    const response = await handler(
      new Request('https://app.example.com/api/github/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      }),
    )
    expect(response.status).toBe(400)
  })

  it('revokes a valid token against a stubbed GitHub and returns { revoked: true }', async () => {
    vi.stubEnv('GITHUB_APP_CLIENT_ID', 'id')
    vi.stubEnv('GITHUB_APP_CLIENT_SECRET', 'secret')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    )

    const response = await handler(postRequest({ token: 'ghu_abc' }))
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const body = (await response.json()) as { revoked: boolean }
    expect(body.revoked).toBe(true)
  })

  it('surfaces a GitHub-side rejection as a 502, not a 200', async () => {
    vi.stubEnv('GITHUB_APP_CLIENT_ID', 'id')
    vi.stubEnv('GITHUB_APP_CLIENT_SECRET', 'secret')
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ message: 'Validation failed' }), { status: 422 }),
      ),
    )

    const response = await handler(postRequest({ token: 'ghu_abc' }))
    expect(response.status).toBe(502)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('github_revoke_failed')
  })

  it('never leaks the client secret or the token in a 500 when the server is misconfigured', async () => {
    // No GITHUB_APP_CLIENT_ID/SECRET stubbed — simulates a deployment
    // missing the env var.
    const response = await handler(postRequest({ token: 'ghu_super_secret_value' }))
    expect(response.status).toBe(500)
    const text = await response.text()
    expect(text).not.toContain('GITHUB_APP_CLIENT_SECRET')
    expect(text).not.toContain('ghu_super_secret_value')
    const body = JSON.parse(text) as { error: string }
    expect(body.error).toBe('server_misconfigured')
  })
})

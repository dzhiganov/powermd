import { describe, expect, it } from 'vitest'

import {
  buildAuthorizeUrl,
  generateOAuthState,
  parseCallbackParams,
  verifyOAuthState,
} from './oauth'

describe('generateOAuthState', () => {
  it('produces a non-empty, sufficiently long token', () => {
    const state = generateOAuthState()
    expect(typeof state).toBe('string')
    expect(state.length).toBeGreaterThanOrEqual(16)
  })

  it('never repeats across calls', () => {
    const states = new Set(Array.from({ length: 50 }, () => generateOAuthState()))
    expect(states.size).toBe(50)
  })
})

describe('buildAuthorizeUrl', () => {
  it('targets github.com/login/oauth/authorize with client_id, state, and redirect_uri', () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: 'Iv1.abc123',
        state: 'the-state-value',
        redirectUri: 'https://example.com/auth/github/callback',
      }),
    )
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe('Iv1.abc123')
    expect(url.searchParams.get('state')).toBe('the-state-value')
    expect(url.searchParams.get('redirect_uri')).toBe('https://example.com/auth/github/callback')
  })

  it('never leaks a client_secret-shaped param — there is none to leak', () => {
    const url = new URL(
      buildAuthorizeUrl({ clientId: 'x', state: 'y', redirectUri: 'https://example.com/cb' }),
    )
    expect(url.searchParams.has('client_secret')).toBe(false)
  })
})

describe('verifyOAuthState — CSRF', () => {
  it('accepts a matching, non-empty pair', () => {
    expect(verifyOAuthState('abc', 'abc')).toBe(true)
  })

  it('rejects a mismatch', () => {
    expect(verifyOAuthState('abc', 'def')).toBe(false)
  })

  it('rejects when nothing was ever stored (expected is null) even if a state arrives', () => {
    expect(verifyOAuthState(null, 'def')).toBe(false)
  })

  it('rejects when the callback carries no state at all', () => {
    expect(verifyOAuthState('abc', null)).toBe(false)
  })

  it('rejects two empty strings — an empty state is never valid', () => {
    expect(verifyOAuthState('', '')).toBe(false)
  })

  it('rejects both null', () => {
    expect(verifyOAuthState(null, null)).toBe(false)
  })
})

describe('parseCallbackParams', () => {
  it('parses a successful code+state callback', () => {
    expect(parseCallbackParams('?code=abc123&state=xyz789')).toEqual({
      code: 'abc123',
      state: 'xyz789',
    })
  })

  it('parses a declined-authorization error, preferring error_description', () => {
    expect(parseCallbackParams('?error=access_denied&error_description=The+user+declined')).toEqual(
      { error: 'The user declined' },
    )
  })

  it('falls back to the bare error code when no description is present', () => {
    expect(parseCallbackParams('?error=access_denied')).toEqual({ error: 'access_denied' })
  })

  it('returns null when this is not a GitHub callback at all', () => {
    expect(parseCallbackParams('')).toBeNull()
    expect(parseCallbackParams('?foo=bar')).toBeNull()
  })

  it('returns null when code is present but state is missing (or vice versa)', () => {
    expect(parseCallbackParams('?code=abc123')).toBeNull()
    expect(parseCallbackParams('?state=xyz789')).toBeNull()
  })
})

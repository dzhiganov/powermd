import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Focused on the three link-building functions — `getAppInstallUrl`,
 * `getManageInstallationsUrl`, `getManualRevokeUrl` — since renaming the
 * GitHub App (which changes `VITE_GITHUB_APP_SLUG` but NOT the client id)
 * is exactly the production bug this module now guards against: any link
 * built from the slug can 404 after a rename, so only the install deep
 * link may still depend on it, and even that must degrade to a generic,
 * slug-independent settings page rather than go dead when the slug is
 * unset. `CLIENT_ID`/`APP_SLUG` are read from `import.meta.env` once at
 * module load, so every test stubs the env it needs BEFORE dynamically
 * importing `./oauth`, and resets modules in between so each test gets a
 * fresh read.
 */

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('getAppInstallUrl', () => {
  it('builds a slug-based deep link when VITE_GITHUB_APP_SLUG is configured', async () => {
    vi.stubEnv('VITE_GITHUB_APP_SLUG', 'my-renamed-app')
    const { getAppInstallUrl } = await import('./oauth')

    expect(getAppInstallUrl()).toBe('https://github.com/apps/my-renamed-app/installations/new')
  })

  it('degrades to the generic installations settings page when the slug is unset', async () => {
    vi.stubEnv('VITE_GITHUB_APP_SLUG', '')
    const { getAppInstallUrl, getManageInstallationsUrl } = await import('./oauth')

    // Never null, never a dead link — always somewhere valid to land.
    expect(getAppInstallUrl()).toBe(getManageInstallationsUrl())
    expect(getAppInstallUrl()).toBe('https://github.com/settings/installations')
  })
})

describe('getManageInstallationsUrl', () => {
  it('is always the generic, slug-independent installations page', async () => {
    vi.stubEnv('VITE_GITHUB_APP_SLUG', 'whatever-the-slug-was-before-a-rename')
    const { getManageInstallationsUrl } = await import('./oauth')

    // Deliberately does NOT depend on the slug at all — a rename can never
    // break this link, unlike the old behavior where this reused the
    // slug-based install deep link for "manage access" too.
    expect(getManageInstallationsUrl()).toBe('https://github.com/settings/installations')
  })

  it('is unaffected by the slug being unset entirely', async () => {
    vi.stubEnv('VITE_GITHUB_APP_SLUG', '')
    const { getManageInstallationsUrl } = await import('./oauth')

    expect(getManageInstallationsUrl()).toBe('https://github.com/settings/installations')
  })
})

describe('getManualRevokeUrl', () => {
  it('is always the generic authorized-apps settings page, regardless of client id', async () => {
    vi.stubEnv('VITE_GITHUB_APP_CLIENT_ID', 'Iv1.some-client-id')
    const { getManualRevokeUrl } = await import('./oauth')

    // Deliberately not a client-id-derived deep link — generic and stable.
    expect(getManualRevokeUrl()).toBe('https://github.com/settings/apps/authorizations')
  })

  it('still returns a valid link when no GitHub App is configured at all', async () => {
    vi.stubEnv('VITE_GITHUB_APP_CLIENT_ID', '')
    const { getManualRevokeUrl } = await import('./oauth')

    expect(getManualRevokeUrl()).toBe('https://github.com/settings/apps/authorizations')
  })
})

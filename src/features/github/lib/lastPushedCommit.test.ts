import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearStoredLastPushedCommit,
  getStoredLastPushedCommit,
  storeLastPushedCommit,
} from './lastPushedCommit'

/** Same stubbed in-memory `localStorage` shape used by `model/connection.test.ts`
 * / `model/repos.test.ts`, so `readStorage`/`writeStorage` (`@/shared/lib/storage`)
 * run for real against it rather than needing their own mock. */
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
  vi.stubGlobal('localStorage', createFakeStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getStoredLastPushedCommit', () => {
  it('returns null when nothing was ever stored', () => {
    expect(getStoredLastPushedCommit('alice', 'repo', 'main')).toBeNull()
  })

  it('round-trips a sha for the exact owner/repo/branch it was stored under', () => {
    storeLastPushedCommit('alice', 'notes', 'main', 'deadbeef')
    expect(getStoredLastPushedCommit('alice', 'notes', 'main')).toBe('deadbeef')
  })

  it('never hands the sha back to a different repository, even same owner/branch', () => {
    storeLastPushedCommit('alice', 'notes', 'main', 'deadbeef')
    expect(getStoredLastPushedCommit('alice', 'other-repo', 'main')).toBeNull()
  })

  it('never hands the sha back to a different owner, even same repo/branch', () => {
    storeLastPushedCommit('alice', 'notes', 'main', 'deadbeef')
    expect(getStoredLastPushedCommit('bob', 'notes', 'main')).toBeNull()
  })

  it('never hands the sha back to a different branch, even same owner/repo', () => {
    storeLastPushedCommit('alice', 'notes', 'main', 'deadbeef')
    expect(getStoredLastPushedCommit('alice', 'notes', 'feature-x')).toBeNull()
  })

  it('a later store for a different connection overwrites the single slot, forgetting the old one', () => {
    storeLastPushedCommit('alice', 'notes', 'main', 'deadbeef')
    storeLastPushedCommit('carol', 'diary', 'main', 'cafebabe')

    expect(getStoredLastPushedCommit('carol', 'diary', 'main')).toBe('cafebabe')
    expect(getStoredLastPushedCommit('alice', 'notes', 'main')).toBeNull()
  })

  it('clearStoredLastPushedCommit removes the entry outright', () => {
    storeLastPushedCommit('alice', 'notes', 'main', 'deadbeef')
    clearStoredLastPushedCommit()
    expect(getStoredLastPushedCommit('alice', 'notes', 'main')).toBeNull()
  })

  it('returns null for a malformed stored value instead of throwing', () => {
    localStorage.setItem('markdown-editor:github-last-pushed-commit', '{"not":"valid"}')
    expect(getStoredLastPushedCommit('alice', 'notes', 'main')).toBeNull()

    localStorage.setItem('markdown-editor:github-last-pushed-commit', 'not even json')
    expect(getStoredLastPushedCommit('alice', 'notes', 'main')).toBeNull()
  })
})

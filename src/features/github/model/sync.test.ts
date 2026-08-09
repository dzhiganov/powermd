import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Exercises `pushBatch`'s retry loop (`model/sync.ts`) end-to-end through
 * the public `syncRequested` event, with `../lib/api`'s network calls
 * mocked and `../lib/backoff`'s `computeBackoffDelayMs` overridden to a tiny
 * fixed delay so these tests run in milliseconds with REAL timers rather
 * than fighting fake-timer/microtask ordering — the actual multi-second
 * backoff schedule is covered separately, deterministically, in
 * `../lib/backoff.test.ts`. `GitHubRefConflictError`/`GitHubRateLimitError`
 * are the real classes (via `importOriginal`), since `instanceof` checks
 * throughout `sync.ts` depend on them.
 *
 * Every test dynamically re-imports `./sync`, `./connection`, and
 * `./snapshot` after `vi.resetModules()` (same pattern as
 * `connection.test.ts`/`repos.test.ts`) so every Effector store starts
 * fresh; `localStorage` is a real stubbed in-memory store, so
 * `lib/token.ts`/`lib/config.ts`/`lib/lastPushedCommit.ts` run for real
 * against it.
 */

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    getBranchRef: vi.fn(),
    getCommit: vi.fn(),
    createBlob: vi.fn(),
    createTree: vi.fn(),
    createCommit: vi.fn(),
    createFileViaContents: vi.fn(),
    updateRef: vi.fn(),
    // `syncConnected` (fired by every test below) also triggers
    // `model/import.ts`'s first-connect import, which calls the real
    // `getTree` unless it's mocked too — an unmocked call would hit the
    // real network. An empty tree makes that import a harmless no-op so
    // these tests stay focused on the push/retry path.
    getTree: vi.fn(async () => ({ entries: [], truncated: false })),
  }
})

vi.mock('../lib/backoff', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/backoff')>()
  return { ...actual, computeBackoffDelayMs: vi.fn(() => 30) }
})

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

const CONNECTION = { owner: 'alice', repo: 'notes', branch: 'main', subfolder: '' }

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('localStorage', createFakeStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('pushBatch retry loop', () => {
  it('stops retrying and never calls updateRef again once the connection is disconnected mid-backoff', async () => {
    const { getBranchRef, getCommit, createBlob, createTree, createCommit, updateRef } =
      await import('../lib/api')
    const { GitHubRefConflictError } = await import('../lib/api')
    vi.mocked(getBranchRef).mockResolvedValue({ sha: 'aaaaaaaa11111111' })
    vi.mocked(getCommit).mockResolvedValue({ treeSha: 'tree-1' })
    vi.mocked(createBlob).mockResolvedValue({ sha: 'blob-1' })
    vi.mocked(createTree).mockResolvedValue({ sha: 'tree-2' })
    vi.mocked(createCommit).mockResolvedValue({ sha: 'commit-1' })
    // Every attempt is rejected as a conflict — simulates the real-world bug
    // (the tip never appears to move within the retry window).
    vi.mocked(updateRef).mockRejectedValue(new GitHubRefConflictError('nope'))

    const { storeToken } = await import('../lib/token')
    const { syncConnected, disconnectRequested } = await import('./connection')
    const { documentsSnapshotChanged } = await import('./snapshot')
    const { syncRequested } = await import('./sync')

    storeToken('tok')
    syncConnected(CONNECTION)
    // `syncConnected` also kicks off `model/import.ts`'s first-connect
    // import (mocked to an empty tree above); let that harmless no-op
    // settle — and the sync attempt it triggers, which sees no dirty docs
    // yet and resolves immediately — BEFORE handing over the actual dirty
    // document below. Otherwise that import's own `importCompleted` can
    // race this test's `syncRequested()` and queue a spurious second push
    // cycle once the first settles (`$rerunQueued`), double-counting every
    // mock call below.
    await wait(5)
    documentsSnapshotChanged([
      {
        id: 'doc-1',
        title: 'Doc',
        content: 'hello',
        folderId: null,
        origin: { ...CONNECTION, path: 'doc.md', syncedHash: null },
      },
    ])

    syncRequested()

    // Let the first attempt's (mocked, near-instant) network chain run and
    // land in the backoff wait — well under the mocked 30ms delay.
    await wait(15)
    expect(updateRef).toHaveBeenCalledTimes(1)
    expect(getBranchRef).toHaveBeenCalledTimes(1)

    disconnectRequested()

    // Give the mocked 30ms backoff timer time to fire and the abort check
    // (which reads `$syncConnection`) time to run, plus slack.
    await wait(80)

    // The retry loop must have stopped: no second `getBranchRef`/`updateRef`
    // call was ever made after the connection was torn down.
    expect(updateRef).toHaveBeenCalledTimes(1)
    expect(getBranchRef).toHaveBeenCalledTimes(1)
  })

  it('keeps $syncStatus at "syncing" (not idle) while backing off, then resolves once the retry succeeds', async () => {
    const { getBranchRef, getCommit, createBlob, createTree, createCommit, updateRef } =
      await import('../lib/api')
    const { GitHubRefConflictError } = await import('../lib/api')
    vi.mocked(getBranchRef).mockResolvedValue({ sha: 'aaaaaaaa11111111' })
    vi.mocked(getCommit).mockResolvedValue({ treeSha: 'tree-1' })
    vi.mocked(createBlob).mockResolvedValue({ sha: 'blob-1' })
    vi.mocked(createTree).mockResolvedValue({ sha: 'tree-2' })
    vi.mocked(createCommit).mockResolvedValue({ sha: 'commit-1' })
    let calls = 0
    vi.mocked(updateRef).mockImplementation(async () => {
      calls += 1
      if (calls === 1) throw new GitHubRefConflictError('nope')
      // Second attempt succeeds.
    })

    const { storeToken } = await import('../lib/token')
    const { syncConnected } = await import('./connection')
    const { documentsSnapshotChanged } = await import('./snapshot')
    const { syncRequested, $syncStatus } = await import('./sync')

    storeToken('tok')
    syncConnected(CONNECTION)
    // `syncConnected` also kicks off `model/import.ts`'s first-connect
    // import (mocked to an empty tree above); let that harmless no-op
    // settle — and the sync attempt it triggers, which sees no dirty docs
    // yet and resolves immediately — BEFORE handing over the actual dirty
    // document below. Otherwise that import's own `importCompleted` can
    // race this test's `syncRequested()` and queue a spurious second push
    // cycle once the first settles (`$rerunQueued`), double-counting every
    // mock call below.
    await wait(5)
    documentsSnapshotChanged([
      {
        id: 'doc-1',
        title: 'Doc',
        content: 'hello',
        folderId: null,
        origin: { ...CONNECTION, path: 'doc.md', syncedHash: null },
      },
    ])

    syncRequested()

    await wait(15) // first attempt has failed, now inside the 30ms backoff wait
    expect($syncStatus.getState()).toBe('syncing')

    await wait(80) // backoff elapses, retry succeeds, effect settles
    expect(updateRef).toHaveBeenCalledTimes(2)
    expect($syncStatus.getState()).toBe('synced')
  })

  it('reports propagation lag (not a conflict) when every retry is exhausted but a fresh re-read finds the tip unchanged', async () => {
    const { getBranchRef, getCommit, createBlob, createTree, createCommit, updateRef } =
      await import('../lib/api')
    const { GitHubRefConflictError } = await import('../lib/api')
    // Every read — including the post-exhaustion diagnostic re-read — reports
    // the exact same tip: nothing ever actually raced this client.
    vi.mocked(getBranchRef).mockResolvedValue({ sha: 'aaaaaaaa11111111' })
    vi.mocked(getCommit).mockResolvedValue({ treeSha: 'tree-1' })
    vi.mocked(createBlob).mockResolvedValue({ sha: 'blob-1' })
    vi.mocked(createTree).mockResolvedValue({ sha: 'tree-2' })
    vi.mocked(createCommit).mockResolvedValue({ sha: 'commit-1' })
    vi.mocked(updateRef).mockRejectedValue(new GitHubRefConflictError('nope'))

    const { storeToken } = await import('../lib/token')
    const { syncConnected } = await import('./connection')
    const { documentsSnapshotChanged } = await import('./snapshot')
    const { syncRequested, $syncError } = await import('./sync')

    storeToken('tok')
    syncConnected(CONNECTION)
    // `syncConnected` also kicks off `model/import.ts`'s first-connect
    // import (mocked to an empty tree above); let that harmless no-op
    // settle — and the sync attempt it triggers, which sees no dirty docs
    // yet and resolves immediately — BEFORE handing over the actual dirty
    // document below. Otherwise that import's own `importCompleted` can
    // race this test's `syncRequested()` and queue a spurious second push
    // cycle once the first settles (`$rerunQueued`), double-counting every
    // mock call below.
    await wait(5)
    documentsSnapshotChanged([
      {
        id: 'doc-1',
        title: 'Doc',
        content: 'hello',
        folderId: null,
        origin: { ...CONNECTION, path: 'doc.md', syncedHash: null },
      },
    ])

    syncRequested()

    // 7 backoff waits of 30ms (mocked) between the 8 attempts, plus the
    // diagnostic re-read and generous slack.
    await wait(500)

    const message = $syncError.getState()
    expect(message).not.toBeNull()
    expect(message).toContain("hasn't finished propagating")
    expect(message).toContain('Nothing was lost')
    expect(message).not.toContain('Could not move the branch')
  })

  it('keeps the existing conflict message (with identities) when the re-read tip genuinely differs', async () => {
    const { getBranchRef, getCommit, createBlob, createTree, createCommit, updateRef } =
      await import('../lib/api')
    const { GitHubRefConflictError } = await import('../lib/api')
    let branchReads = 0
    vi.mocked(getBranchRef).mockImplementation(async () => {
      branchReads += 1
      // The final call is the post-exhaustion diagnostic re-read — report a
      // genuinely different tip there, simulating a real concurrent writer.
      return { sha: branchReads >= 9 ? 'bbbbbbbb22222222' : 'aaaaaaaa11111111' }
    })
    vi.mocked(getCommit).mockResolvedValue({ treeSha: 'tree-1' })
    vi.mocked(createBlob).mockResolvedValue({ sha: 'blob-1' })
    vi.mocked(createTree).mockResolvedValue({ sha: 'tree-2' })
    vi.mocked(createCommit).mockResolvedValue({ sha: 'commit-1' })
    vi.mocked(updateRef).mockRejectedValue(
      new GitHubRefConflictError('Update is not a fast forward'),
    )

    const { storeToken } = await import('../lib/token')
    const { syncConnected } = await import('./connection')
    const { documentsSnapshotChanged } = await import('./snapshot')
    const { syncRequested, $syncError } = await import('./sync')

    storeToken('tok')
    syncConnected(CONNECTION)
    // `syncConnected` also kicks off `model/import.ts`'s first-connect
    // import (mocked to an empty tree above); let that harmless no-op
    // settle — and the sync attempt it triggers, which sees no dirty docs
    // yet and resolves immediately — BEFORE handing over the actual dirty
    // document below. Otherwise that import's own `importCompleted` can
    // race this test's `syncRequested()` and queue a spurious second push
    // cycle once the first settles (`$rerunQueued`), double-counting every
    // mock call below.
    await wait(5)
    documentsSnapshotChanged([
      {
        id: 'doc-1',
        title: 'Doc',
        content: 'hello',
        folderId: null,
        origin: { ...CONNECTION, path: 'doc.md', syncedHash: null },
      },
    ])

    syncRequested()
    await wait(500)

    const message = $syncError.getState()
    expect(message).not.toBeNull()
    expect(message).toContain('Update is not a fast forward')
    expect(message).toContain('read tip aaaaaaaa')
    expect(message).toContain('after 8 attempt(s)')
    expect(message).not.toContain("hasn't finished propagating")
  })
})

describe('lastPushedCommitSha persistence', () => {
  it('survives a reload and is preferred over a stale ref read for the next push', async () => {
    const api = await import('../lib/api')
    vi.mocked(api.getBranchRef).mockResolvedValue({ sha: 'ref-v1' })
    vi.mocked(api.getCommit).mockResolvedValue({ treeSha: 'tree-1' })
    vi.mocked(api.createBlob).mockResolvedValue({ sha: 'blob-1' })
    vi.mocked(api.createTree).mockResolvedValue({ sha: 'tree-2' })
    vi.mocked(api.createCommit).mockResolvedValue({ sha: 'commit-v1' })
    vi.mocked(api.updateRef).mockResolvedValue(undefined)

    const { storeToken } = await import('../lib/token')
    const { syncConnected } = await import('./connection')
    const { documentsSnapshotChanged } = await import('./snapshot')
    const { syncRequested } = await import('./sync')

    storeToken('tok')
    syncConnected(CONNECTION)
    // `syncConnected` also kicks off `model/import.ts`'s first-connect
    // import (mocked to an empty tree above); let that harmless no-op
    // settle — and the sync attempt it triggers, which sees no dirty docs
    // yet and resolves immediately — BEFORE handing over the actual dirty
    // document below. Otherwise that import's own `importCompleted` can
    // race this test's `syncRequested()` and queue a spurious second push
    // cycle once the first settles (`$rerunQueued`), double-counting every
    // mock call below.
    await wait(5)
    documentsSnapshotChanged([
      {
        id: 'doc-1',
        title: 'Doc',
        content: 'v1',
        folderId: null,
        origin: { ...CONNECTION, path: 'doc.md', syncedHash: null },
      },
    ])

    syncRequested()
    await wait(50)

    expect(api.updateRef).toHaveBeenCalledWith('tok', 'alice', 'notes', 'main', 'commit-v1')

    const { getStoredLastPushedCommit } = await import('../lib/lastPushedCommit')
    expect(getStoredLastPushedCommit('alice', 'notes', 'main')).toBe('commit-v1')

    // --- Simulate a reload: fresh module graph, but the SAME localStorage
    // (not re-stubbed), matching what actually persists across a real
    // reload/PWA restart. Deliberately does NOT call `syncConnected` again —
    // a real reload never does (see `connection.ts`'s `initGithub`;
    // `$syncConnection` is seeded straight from `getStoredConfig()` at
    // module init, exactly like `lastPushedCommit` itself). Calling
    // `syncConnected` here would be wrong twice over: it doesn't happen on a
    // real reload, and it would trip `forgetLastPushedCommit` (this module's
    // own `syncConnected.watch(...)`), erasing the very thing this test is
    // proving survives.
    vi.resetModules()
    const freshApi = await import('../lib/api')
    // GitHub is still reporting the pre-push tip — propagation lag. A naive
    // implementation with no persisted memory would build on this stale
    // ref and immediately hit "not a fast forward" again.
    vi.mocked(freshApi.getBranchRef).mockResolvedValue({ sha: 'ref-v1' })
    vi.mocked(freshApi.getCommit).mockResolvedValue({ treeSha: 'tree-2' })
    vi.mocked(freshApi.createBlob).mockResolvedValue({ sha: 'blob-2' })
    vi.mocked(freshApi.createTree).mockResolvedValue({ sha: 'tree-3' })
    vi.mocked(freshApi.createCommit).mockResolvedValue({ sha: 'commit-v2' })
    vi.mocked(freshApi.updateRef).mockResolvedValue(undefined)

    const { $syncConnection: $freshSyncConnection } = await import('./connection')
    const { documentsSnapshotChanged: freshSnapshotChanged } = await import('./snapshot')
    const { syncRequested: freshSyncRequested } = await import('./sync')

    // Confirms the connection itself was restored from storage too, with no
    // `syncConnected` re-fire needed.
    expect($freshSyncConnection.getState()).toEqual(CONNECTION)

    freshSnapshotChanged([
      {
        id: 'doc-1',
        title: 'Doc',
        content: 'v2', // changed since the last push -> dirty again
        folderId: null,
        origin: { ...CONNECTION, path: 'doc.md', syncedHash: null },
      },
    ])

    freshSyncRequested()
    await wait(50)

    // The base tree came from the PERSISTED commit, not the stale ref read —
    // proof the reload didn't forget it.
    expect(freshApi.getCommit).toHaveBeenCalledWith('tok', 'alice', 'notes', 'commit-v1')
    expect(freshApi.updateRef).toHaveBeenCalledWith('tok', 'alice', 'notes', 'main', 'commit-v2')
  })

  it('never reuses a remembered sha for a different repository', async () => {
    const { storeLastPushedCommit, getStoredLastPushedCommit } =
      await import('../lib/lastPushedCommit')
    storeLastPushedCommit('alice', 'notes', 'main', 'commit-for-notes')
    expect(getStoredLastPushedCommit('alice', 'a-different-repo', 'main')).toBeNull()
  })

  it('clears the remembered sha on disconnect', async () => {
    const { storeLastPushedCommit, getStoredLastPushedCommit } =
      await import('../lib/lastPushedCommit')
    const { disconnectRequested } = await import('./connection')
    // `./sync` must be imported so its `disconnectRequested.watch(...)` wiring
    // is actually registered before the event fires.
    await import('./sync')

    storeLastPushedCommit('alice', 'notes', 'main', 'commit-x')
    disconnectRequested()
    expect(getStoredLastPushedCommit('alice', 'notes', 'main')).toBeNull()
  })

  it('clears the remembered sha when the connection changes to a different repo/branch', async () => {
    const { storeLastPushedCommit, getStoredLastPushedCommit } =
      await import('../lib/lastPushedCommit')
    const { syncConnected } = await import('./connection')
    await import('./sync')

    storeLastPushedCommit('alice', 'notes', 'main', 'commit-x')
    syncConnected({ owner: 'alice', repo: 'other-notes', branch: 'main', subfolder: '' })
    expect(getStoredLastPushedCommit('alice', 'notes', 'main')).toBeNull()
  })
})

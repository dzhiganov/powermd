import { $activeId, documentSelected } from '@/features/documents'

/**
 * Puts the active document's id in the URL as a query param (`?doc=<id>`)
 * and keeps it in sync with `$activeId` from then on, so a document can be
 * opened directly by URL and the browser's back/forward buttons move
 * between documents.
 *
 * Two deliberate choices, both because this app has exactly one screen:
 *
 * - A query param, not a path segment (`/d/<id>`). A path segment needs the
 *   host to rewrite every such path back to `index.html` for a direct
 *   load/refresh to resolve — this app has no server-side routing config
 *   (`vite build` output served as plain static files), so a path-based
 *   scheme would 404 on refresh depending on the host. `?doc=<id>` on the
 *   root path works with zero server configuration on any static host.
 * - The History API directly, not Vue Router. Router's actual job —
 *   matching a path to a component — doesn't apply when there's only one
 *   screen; all that's needed is "read/write one query param, react to
 *   back/forward", which `history.pushState`/`replaceState` and the
 *   `popstate` event already do in a few lines, without a new dependency
 *   or a route table for a single route.
 *
 * Precedence: a document id already in the URL at load time wins over the
 * persisted `activeId` (`features/documents/model/documents.ts`'s own
 * IndexedDB-backed restore) — see `resolveInitialUrl` below. An id that
 * doesn't resolve to a real document (hand-typed, or a deleted document's
 * stale link) is not an error: `documentSelected` already no-ops for an
 * unknown id (see its `sample`'s `filter` in `documents.ts`), so the
 * persisted/fallback resolution `documents` already computed silently wins
 * instead, and this module corrects the URL to match rather than leaving a
 * dead link standing in the address bar.
 */

const DOC_PARAM = 'doc'

function readDocId(): string | null {
  return new URL(window.location.href).searchParams.get(DOC_PARAM)
}

function writeDocId(id: string, mode: 'push' | 'replace'): void {
  const url = new URL(window.location.href)
  url.searchParams.set(DOC_PARAM, id)
  if (mode === 'push') {
    window.history.pushState(null, '', url)
  } else {
    window.history.replaceState(null, '', url)
  }
}

/**
 * Runs once, the first time `$activeId` resolves after startup (the
 * documents feature's restore-from-IndexedDB/seed, see `loadFx` in
 * `documents.ts`). Reconciles that resolution against whatever id (if any)
 * the URL already carried at load, per the precedence rule above, then
 * corrects the address bar to reflect the actual outcome — replacing, not
 * pushing, since this is a correction of the entry the browser is already
 * on, not a new navigation.
 */
function resolveInitialUrl(): void {
  const urlId = readDocId()
  const resolvedId = $activeId.getState()
  if (resolvedId === null) return

  if (urlId !== null && urlId !== resolvedId) {
    // A no-op if `urlId` isn't a real document — `$activeId` then simply
    // stays at `resolvedId`, and the write below corrects the URL back to
    // it instead of leaving the bad id standing. `documentSelected` also
    // already flushes any pending autosave for the outgoing document before
    // switching (see `documents.ts`'s flush-on-switch `sample`), so going
    // through it here rather than touching `$activeId` directly keeps that
    // protection intact for a URL-driven switch too.
    documentSelected(urlId)
  }

  const finalId = $activeId.getState()
  if (finalId !== null) writeDocId(finalId, 'replace')
}

/**
 * Keeps the URL in sync with every later `$activeId` change (switch,
 * create, duplicate, a delete's auto-reassignment, import, GitHub open) —
 * each becomes a new, navigable history entry, so browser back/forward
 * moves between documents. Skipped when the URL already carries the new id
 * — the only way that happens is `onPopState` below having already written
 * it natively as part of the browser's own back/forward navigation, which
 * must not also be pushed as a *new* entry (that would fight the very
 * navigation the user just performed).
 */
function attachOngoingSync(): void {
  $activeId.watch((id) => {
    if (id === null) return
    if (readDocId() === id) return
    writeDocId(id, 'push')
  })
}

/**
 * Browser back/forward: the URL has already changed by the time this
 * fires (native browser behaviour) — resolve `$activeId` to match, same
 * fallback rule as the initial load (`documentSelected` no-ops on an
 * unknown id). If that didn't land on the URL's own id (missing, or the id
 * turned out invalid), correct the entry in place rather than pushing a new
 * one — pushing here would break the very back/forward chain the user is
 * actively navigating.
 */
function onPopState(): void {
  const urlId = readDocId()
  if (urlId !== null) documentSelected(urlId)

  const activeId = $activeId.getState()
  if (activeId !== null && urlId !== activeId) writeDocId(activeId, 'replace')
}

/** Called once from `src/app/wiring.ts`, after `initDocuments` has kicked
 * off the restore/seed (see that call's own comment) — matching every
 * other one-time init call in that file. */
export function initUrlSync(): void {
  if (typeof window === 'undefined') return

  const unwatch = $activeId.watch((id) => {
    if (id === null) return
    // Runs exactly once: unsubscribe before doing anything else so
    // `resolveInitialUrl`'s own `documentSelected` call (which updates
    // `$activeId` again) can't re-enter this branch.
    unwatch()
    resolveInitialUrl()
    attachOngoingSync()
  })

  window.addEventListener('popstate', onPopState)
}

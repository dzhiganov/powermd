import { combine, createEvent, createStore } from 'effector'
import { debounce } from 'patronum'

import { searchDocuments, type SearchResult } from '../lib/search'
import { $documentList, $folders } from './documents'

/**
 * Sidebar search (Phase 3 visual redesign) — filters documents by title
 * and content. Lives alongside the rest of the `documents` model since the
 * search box sits in this feature's own sidebar (`DocumentDrawer.vue`,
 * which already reserved the space — see that file's header comment) and
 * searches this feature's own in-memory document list; no other feature
 * needs to know search exists.
 *
 * Performance: `searchDocuments` (the actual filter — see `lib/search.ts`)
 * was measured directly against a synthetic 200-document corpus averaging
 * ~11KB of content each (~2.1MB total, deliberately on the larger side of
 * "realistic" for this app), a size chosen to stress-test whether a linear
 * scan over `$documentList` — the same in-memory array already backing the
 * sidebar, no IndexedDB read — could still block typing. Measured (Node,
 * `performance.now()`, 50 runs per query): p50 ~0.4ms, p95 ~0.6-1.0ms,
 * worst observed ~1.75ms for a single search across the whole corpus —
 * roughly a tenth of a 16ms frame budget, even before any debounce. That
 * measurement is what settled "does this need an inverted index or other
 * pre-built search structure" without guessing: no, a plain
 * `String.prototype.includes` scan over already-in-memory content is not
 * the bottleneck at this scale, so none was built. The debounce below
 * still exists — not because the scan itself is slow, but so a fast typist
 * doesn't re-run even a sub-millisecond scan on every single keystroke,
 * the same "debounce first, only build real infrastructure if debouncing
 * turns out not to be enough" instinct this codebase already applies to
 * `preview/model/preview.ts`'s render and `documents/model/documents.ts`'s
 * autosave.
 */

/** Fired on every keystroke in the search box — drives the input's own
 * displayed value immediately, so typing itself never feels debounced,
 * only the (already cheap, see above) filtering that runs off it. */
export const searchQueryChanged = createEvent<string>()
/** Escape, or the box's own clear button. */
export const searchCleared = createEvent()

export const $searchQuery = createStore('')
  .on(searchQueryChanged, (_, query) => query)
  .reset(searchCleared)

const debouncedQueryChanged = debounce(searchQueryChanged, 150)
const $debouncedQuery = createStore('')
  .on(debouncedQueryChanged, (_, query) => query)
  .reset(searchCleared)

const $folderNames = $folders.map((folders) => new Map(folders.map((f) => [f.id, f.name])))

/** `null` while not searching (the tree renders instead); an array
 * (possibly empty — "searching, nothing matched") once a query is active.
 * Distinguishing the two is what lets the UI tell "haven't searched yet"
 * apart from "searched, no matches" without a second boolean — and, since
 * `$isSearching` below is derived from this same store rather than the
 * instant `$searchQuery`, the sidebar can never show a false "no matches"
 * flash for the ~150ms between the first keystroke and the debounced
 * filter actually running: the tree simply stays put a beat longer instead
 * of swapping to results before there are any to show. */
export const $searchResults = combine(
  $debouncedQuery,
  $documentList,
  $folderNames,
  (query, docs, folderNames): SearchResult[] | null => {
    if (query.trim() === '') return null
    return searchDocuments(docs, folderNames, query)
  },
)

/** Whether the sidebar should show search results instead of the normal
 * folder/document tree. */
export const $isSearching = $searchResults.map((results) => results !== null)

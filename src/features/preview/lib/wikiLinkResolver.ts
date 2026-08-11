import { WIKI_LINK_CLASS } from './remarkWikiLink'

/**
 * Resolves the neutral `<a class="wiki-link" data-wikilink-title="...">`
 * markers `remarkWikiLink.ts`/`pipeline.ts` emit against the live document
 * list, on the main thread — the render worker (`worker.ts`) can't do this
 * itself, since it's a pure string -> string function with no notion that a
 * document list even exists. Same structural split as
 * `mermaidRenderer.ts` (worker emits inert markup, main thread finishes the
 * job after `v-html`/DOM insertion), just resolving app state instead of
 * doing DOM-dependent rendering.
 *
 * This module is never imported by `pipeline.ts`/`worker.ts` — it uses
 * `DOMParser`, a main-thread-only API unavailable in the render worker
 * (`tsconfig.worker.json` sets `lib: ["ES2023", "WebWorker"]`, which has no
 * `DOMParser`), and has no reason to run there anyway: resolution always
 * happens after the worker's sanitized HTML already exists, never as part
 * of producing it.
 *
 * Two call sites, both driven by titles/ids only — this module has no
 * notion of `MarkdownDocument` (a `preview` -> `documents` import would
 * violate the feature boundary; see `ARCHITECTURE.md`) and gets the
 * candidate title/id pairs handed to it from whichever caller does know
 * about documents:
 *
 * - `decorateWikiLinks` — the live preview DOM, called from
 *   `ui/Preview.vue` after every `v-html` patch and after every document-
 *   list change, with the resolver built from `model/wikiLinks.ts`'s
 *   `$wikiLinkTargets` (fed by `src/app/wikiLinks.ts`).
 * - `resolveWikiLinksInHtml` — a one-off render's HTML string, for HTML
 *   export / "copy rendered HTML" (`src/app/wiring.ts`'s export
 *   composition), which never touches the live preview DOM at all.
 *
 * Deliberately does NOT write a resolved id anywhere in the DOM/HTML (no
 * `data-wikilink-id`, no real `href`) — only the `wiki-link--resolved` /
 * `wiki-link--unresolved` class, which is purely presentational. The one
 * place a resolution id is actually *used* is `src/app/wikiLinks.ts`'s
 * click handler, which re-resolves the clicked anchor's title against the
 * live document list at click time rather than trusting whatever this
 * module last decorated — so a click a few milliseconds after a rename/
 * delete/create can never act on a stale id, and this module never needs
 * to reason about staleness at all.
 */

export interface WikiLinkTarget {
  id: string
  title: string
}

export interface WikiLinkResolution {
  id: string
}

export type WikiLinkResolver = (title: string) => WikiLinkResolution | null

const RESOLVED_CLASS = 'wiki-link--resolved'
const UNRESOLVED_CLASS = 'wiki-link--unresolved'
const WIKI_LINK_SELECTOR = `a.${WIKI_LINK_CLASS}`
const WIKI_LINK_TITLE_ATTR = 'data-wikilink-title'

/**
 * Builds a case-insensitive, whitespace-trimmed title resolver from a
 * snapshot of `{ id, title }` pairs — the one place this normalization
 * rule (`title.trim().toLowerCase()`) is written down, shared by every
 * caller (`ui/Preview.vue`'s decoration pass and `src/app/wikiLinks.ts`'s
 * click handler) so they can never disagree about what counts as a match.
 * A `Map` lookup, not a linear `Array#find` per call: decorating a
 * document with many wiki-links against the same target snapshot is the
 * common case, and this makes that O(links + targets) instead of
 * O(links * targets).
 */
export function buildTitleResolver(targets: readonly WikiLinkTarget[]): WikiLinkResolver {
  const byTitle = new Map<string, string>()
  for (const target of targets) {
    const key = target.title.trim().toLowerCase()
    if (key === '') continue
    // First document with a given (normalized) title wins — same result
    // a linear `Array#find` over `targets` would give; made explicit here
    // since a plain `Map#set` in a loop would otherwise let the *last*
    // one silently win instead.
    if (!byTitle.has(key)) byTitle.set(key, target.id)
  }

  return (title) => {
    const id = byTitle.get(title.trim().toLowerCase())
    return id === undefined ? null : { id }
  }
}

function decorateAnchor(anchor: Element, resolve: WikiLinkResolver): void {
  const title = anchor.getAttribute(WIKI_LINK_TITLE_ATTR)
  if (title === null) return // not one of ours despite matching the selector — defensive, shouldn't happen
  const resolved = resolve(title) !== null
  anchor.classList.toggle(RESOLVED_CLASS, resolved)
  anchor.classList.toggle(UNRESOLVED_CLASS, !resolved)
}

/**
 * Applies (or re-applies) resolved/unresolved styling to every wiki-link
 * anchor under `root`. Idempotent and cheap to call whenever either input
 * might have changed — a fresh preview render, or a document-list change
 * (rename/create/delete) with no new render — since it only ever reads
 * `data-wikilink-title` and toggles two class names; a call that changes
 * nothing does exactly that: nothing.
 */
export function decorateWikiLinks(root: ParentNode, resolve: WikiLinkResolver): void {
  root.querySelectorAll(WIKI_LINK_SELECTOR).forEach((anchor) => decorateAnchor(anchor, resolve))
}

/**
 * String-in, string-out counterpart of `decorateWikiLinks`, for the paths
 * that never touch the live preview DOM at all — HTML export and "copy
 * rendered HTML". Parses with `DOMParser` rather than a second,
 * regex-based implementation of the same resolution logic, so both paths
 * decorate through the exact same `decorateAnchor` and can never disagree
 * about what "resolved" looks like.
 */
export function resolveWikiLinksInHtml(html: string, resolve: WikiLinkResolver): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  decorateWikiLinks(parsed.body, resolve)
  return parsed.body.innerHTML
}

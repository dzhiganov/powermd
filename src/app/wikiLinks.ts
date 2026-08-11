import { sample } from 'effector'

import { $documentList, documentImported, documentSelected } from '@/features/documents'
import {
  $previewScrollHandle,
  buildTitleResolver,
  wikiLinkTargetsChanged,
  type PreviewScrollHandle,
} from '@/features/preview'

/**
 * Wires wiki-link (`[[Title]]` / `[[Title|alias]]`) navigation and creation
 * — the one place that knows both `documents` (the title list to resolve
 * against, and the events that switch/create a document) and `preview`
 * (the rendered anchors themselves, via `$previewScrollHandle`, and the
 * injected target-list store those anchors get resolved against — see
 * `features/preview/model/wikiLinks.ts`). Neither feature imports the
 * other; this is the one place — same shape as every cross-feature link in
 * `wiring.ts`, and structurally identical to `paneJump.ts`'s editor+preview
 * link — that connects them. Called once from `wiring.ts`.
 *
 * Two independent responsibilities:
 *
 * 1. Keep `preview`'s injected `$wikiLinkTargets` in sync with the live
 *    document list, so `ui/Preview.vue` can decorate resolved vs
 *    unresolved anchors without ever importing `documents` itself.
 * 2. Intercept clicks on a rendered wiki-link anchor and turn them into
 *    the *existing* document-switch/create flow — `documentSelected` for
 *    a title that resolves, `documentImported` (the same "prepend +
 *    activate + persist" event `markdownFileImported` already drives, see
 *    `features/documents/model/documents.ts`) for one that doesn't. This
 *    is deliberately the only navigation path: a resolved click reuses
 *    `documentSelected`, which `src/app/urlSync.ts` already mirrors into
 *    the URL, rather than this module touching history/the URL itself.
 */

function isWikiLinkAnchor(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null
  return target.closest('a.wiki-link')
}

/**
 * Always re-resolves against the *current* `$documentList` rather than
 * trusting whichever `wiki-link--resolved`/`wiki-link--unresolved` class
 * `ui/Preview.vue`'s decoration pass last applied — a click can land a few
 * milliseconds after a rename/create/delete that decoration hasn't caught
 * up with yet (it's driven by its own watcher, not this handler), and
 * this way the two can never disagree about what a given click should do.
 */
function onContentClick(event: MouseEvent): void {
  const anchor = isWikiLinkAnchor(event.target)
  if (!anchor) return

  // The marker's `href` is always the inert `'#'` (see
  // `features/preview/lib/remarkWikiLink.ts`) — there is no meaningful
  // native destination to preserve here the way `paneJump.ts` preserves a
  // modifier-click on a *real* content link, so every click is prevented
  // and handled uniformly regardless of button/modifiers. Without this,
  // the default `href="#"` action would scroll the pane to its top and
  // push a junk history entry, whether or not this handler goes on to do
  // anything with the click.
  event.preventDefault()

  const title = anchor.getAttribute('data-wikilink-title')
  if (title === null) return

  const targets = $documentList.getState().map((doc) => ({ id: doc.id, title: doc.title }))
  const resolution = buildTitleResolver(targets)(title)

  if (resolution) {
    documentSelected(resolution.id)
  } else {
    // Goes through the existing document-creation event so autosave/
    // persistence/cross-tab broadcast all behave exactly as they would
    // for any other new document — see that event's own doc comment.
    // Content starts empty, same as any other freshly created document;
    // the title is the only thing this flow seeds.
    documentImported({ title: title.trim(), content: '' })
  }
}

interface Attached {
  handle: PreviewScrollHandle
  teardown: () => void
}

let attached: Attached | null = null

function attach(handle: PreviewScrollHandle): Attached {
  const contentRoot = handle.getContentRoot()
  contentRoot.addEventListener('click', onContentClick)
  return {
    handle,
    teardown: () => contentRoot.removeEventListener('click', onContentClick),
  }
}

/**
 * Watches `$previewScrollHandle` and (re)attaches the click listener
 * whenever the underlying element changes — same watch/evaluate shape as
 * `initPaneJump`/`initScrollSync`.
 */
function initClickHandling(): void {
  function evaluate(): void {
    const handle = $previewScrollHandle.getState()

    if (attached !== null && attached.handle !== handle) {
      attached.teardown()
      attached = null
    }

    if (handle && !attached) {
      attached = attach(handle)
    }
  }

  $previewScrollHandle.watch(evaluate)
}

export function initWikiLinks(): void {
  initClickHandling()

  // One-kick-then-sample: same shape as every other injected mirror in
  // `wiring.ts` (e.g. `lineWrapChanged`/`autosaveIntervalChanged`) —
  // `sample`'s `clock` only reacts to *later* `$documentList` updates, so
  // the store's already-current value at this module's evaluation time
  // needs an explicit first push.
  wikiLinkTargetsChanged($documentList.getState().map((doc) => ({ id: doc.id, title: doc.title })))
  sample({
    source: $documentList,
    fn: (docs) => docs.map((doc) => ({ id: doc.id, title: doc.title })),
    target: wikiLinkTargetsChanged,
  })
}

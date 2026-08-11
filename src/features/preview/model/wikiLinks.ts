import { createEvent, createStore } from 'effector'

import type { WikiLinkTarget } from '../lib/wikiLinkResolver'

/**
 * The live "what can a wiki-link resolve to" snapshot, injected from
 * outside — `preview` never imports `documents` (see `ARCHITECTURE.md`'s
 * feature-boundary rules), so it has no way to know the document list
 * itself. `src/app/wikiLinks.ts` is the one place that knows both and
 * keeps this fed, the same "cross-feature link lives in `app`, injected
 * into the feature that needs it" shape as `initTransfer`'s
 * `renderMarkdown` dependency or `initDocuments`'s `welcomeContent`.
 *
 * `ui/Preview.vue` reads this (via `useUnit`, for the reactive re-decorate-
 * on-change path) and `lib/wikiLinkResolver.ts`'s `buildTitleResolver`
 * turns a snapshot of it into the actual resolve function.
 */
export const wikiLinkTargetsChanged = createEvent<WikiLinkTarget[]>()

export const $wikiLinkTargets = createStore<WikiLinkTarget[]>([]).on(
  wikiLinkTargetsChanged,
  (_, targets) => targets,
)

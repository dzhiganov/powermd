import { createEffect, createEvent, createStore, sample } from 'effector'
import { debounce } from 'patronum'

import { renderMarkdown } from '../lib/pipeline'

/** Fired with the full markdown source whenever the input the preview
 * should render changes. Nothing in this feature knows or cares where
 * that source comes from — `src/app/wiring.ts` connects it to the
 * editor's `$content`, keeping this feature free of any dependency on
 * the editor feature. */
export const sourceReceived = createEvent<string>()

// Debounced in the Effector layer (via patronum, effector's own
// utility library, rather than a `setTimeout` in a component) so a
// burst of keystrokes collapses into a single render 150ms after typing
// pauses. Keeping it here means the debounce is testable/inspectable as
// plain store/event wiring, and every consumer of `$html` — today just
// `Preview.vue`, potentially more later — gets the debounce for free
// instead of having to re-implement it. The debounce caps how *often* a
// render runs; it does nothing about how long any single render takes,
// which is what `renderFx` below is for.
const debouncedSource = debounce(sourceReceived, 150)

// An effect, not a plain reducer, because rendering cost — not I/O — is
// the concern: it's still synchronous, pure tree transformation, but
// measured up to ~2s for a 10 000-line document, and the debounce above
// can't help with that (it only limits how often a render fires). Routing
// it through `createEffect` + `sample` keeps this synchronous today while
// giving the model the shape it needs to become cancellable/async later
// (e.g. swapping in a worker-backed `.use()` handler) without another
// reshape of the store wiring.
const renderFx = createEffect((source: string) => renderMarkdown(source))

sample({ clock: debouncedSource, target: renderFx })

/** Rendered, sanitized HTML for the current markdown source. */
export const $html = createStore<string>('')
  .on(renderFx.doneData, (_previousHtml, html) => html)
  .on(renderFx.fail, (previousHtml, { error }) => {
    // A render failure must never blank an already-visible preview — keep
    // showing the last successful render and only log the failure.
    console.error('[preview] failed to render markdown', error)
    return previousHtml
  })

import { createEffect, createEvent, createStore, sample } from 'effector'
import { debounce } from 'patronum'

import { nextRenderRequestId, renderInWorker } from '../lib/renderWorkerClient'

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

/** The id of the *latest request this debounced live-preview flow has
 * issued*, read (not just written) inside the `$html` reducer below:
 * rendering now happens off the main thread (`renderInWorker`, backed by
 * `worker.ts`), so requests can complete out of order — a fast render of a
 * short document can land after a slow render of a long one. A response
 * only gets applied if its id still matches this, i.e. no newer request
 * from *this flow* has been issued since. The id itself comes from
 * `nextRenderRequestId`, a counter shared with one-off export renders
 * (`lib/exportRender.ts`) — see that function's doc comment — so this
 * only ever advances on this flow's own calls and stays a correct
 * staleness check even though the underlying numbers aren't contiguous
 * from this module's point of view. */
let latestRequestId = 0

interface RenderResult {
  id: number
  html: string
}

// An effect, not a plain reducer, because rendering cost — not I/O — is
// the concern: measured up to ~2s for a 10 000-line document, which is
// exactly why the actual work happens in a worker (`renderInWorker`)
// instead of blocking here. `createEffect` + `sample` is what already
// made this swap-in possible without reshaping the store wiring below.
const renderFx = createEffect(async (source: string): Promise<RenderResult> => {
  const id = nextRenderRequestId()
  latestRequestId = id
  const html = await renderInWorker(source, id)
  return { id, html }
})

sample({ clock: debouncedSource, target: renderFx })

/** Rendered, sanitized HTML for the current markdown source. */
export const $html = createStore<string>('')
  .on(renderFx.doneData, (previousHtml, result) =>
    result.id === latestRequestId ? result.html : previousHtml,
  )
  .on(renderFx.fail, (previousHtml, { error }) => {
    // A render failure must never blank an already-visible preview — keep
    // showing the last successful render and only log the failure. (The
    // worker/main-thread fallback in `renderInWorker` already retries
    // once before giving up, so reaching here means the pipeline itself
    // threw for this input, not just the worker.)
    console.error('[preview] failed to render markdown', error)
    return previousHtml
  })

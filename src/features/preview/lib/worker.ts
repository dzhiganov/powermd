import { renderMarkdown } from './pipeline'
import type { RenderRequest, RenderResponse } from './workerProtocol'

/**
 * Render worker entry point.
 *
 * Pure message-in, message-out: receives a `{ id, source }` request, runs
 * the exact same `renderMarkdown` pipeline the main thread used to run
 * directly (same `rehype-sanitize` schema, same plugin order — see
 * `pipeline.ts`), and posts back `{ id, ok, html | error }`.
 *
 * This file has no notion of "latest" and never skips or reorders
 * incoming messages — matching responses to requests and discarding
 * stale ones is `renderWorkerClient.ts`'s job, on the main thread, where
 * the request ids are assigned.
 *
 * A thrown error from the pipeline is caught here and reported as a
 * normal `ok: false` message rather than an uncaught worker error, so a
 * single bad input can't take the whole worker down for later requests.
 *
 * Type-checked under `tsconfig.worker.json` (`lib: ["WebWorker"]`), not
 * `tsconfig.app.json` (`lib: [..., "DOM"]`) — see that file and
 * `workerProtocol.ts` for why.
 */
self.addEventListener('message', (event: MessageEvent<RenderRequest>) => {
  const { id, source } = event.data

  let response: RenderResponse
  try {
    response = { id, ok: true, html: renderMarkdown(source) }
  } catch (error) {
    response = { id, ok: false, error: error instanceof Error ? error.message : String(error) }
  }

  self.postMessage(response)
})

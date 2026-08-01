import { renderMarkdown } from './pipeline'
import type { RenderRequest, RenderResponse } from './workerProtocol'

/**
 * Main-thread wrapper around the render worker (`worker.ts`). Owns the
 * worker's lifecycle — lazy construction, recovery from construction
 * failure or a stuck/crashed worker, and clean teardown — and the
 * request/response matching `model/preview.ts` needs to discard stale
 * results by id.
 *
 * This module is deliberately unopinionated about "staleness": it always
 * resolves the promise it hands back for a given id with whatever html
 * was produced for that id (by the worker, or by the main-thread
 * fallback). Deciding whether that id is still the *latest* one is
 * `model/preview.ts`'s job, not this transport layer's.
 */

/** Generous relative to the worst measured render (~2.1s for a
 * 10 000-line document): long enough that a legitimately slow render on
 * a huge document never trips it, short enough that a genuinely hung
 * worker is recovered from well within a session. This is the only
 * situation in which the worker is torn down and replaced — routine
 * supersession by newer input is handled by id-based discarding instead,
 * not by restarting the worker (see `model/preview.ts`). */
const STUCK_WORKER_TIMEOUT_MS = 8000

interface PendingRequest {
  source: string
  resolve: (html: string) => void
  reject: (error: unknown) => void
}

let worker: Worker | null = null
let workerConstructionFailed = false
const pending = new Map<number, PendingRequest>()
const timeouts = new Map<number, ReturnType<typeof setTimeout>>()

let requestCounter = 0

/**
 * Shared id source for every caller of `renderInWorker` — the live
 * preview's debounced pipeline (`model/preview.ts`) and one-off export
 * renders (`lib/exportRender.ts`) alike. `pending` above is keyed by id;
 * if two independent callers each kept their own "starts at 0, increments
 * by 1" counter, a live-preview request and an export request could be
 * assigned the same id while both are in flight, and the second `pending.set`
 * would silently overwrite the first entry — the first request would then
 * never resolve from a real response (only, eventually, from the
 * stuck-worker timeout). One shared counter makes that collision
 * impossible.
 */
export function nextRenderRequestId(): number {
  requestCounter += 1
  return requestCounter
}

function clearPending(id: number): void {
  pending.delete(id)
  const timeout = timeouts.get(id)
  if (timeout !== undefined) {
    clearTimeout(timeout)
    timeouts.delete(id)
  }
}

/** Settles one pending request via the main-thread pipeline, the same
 * one the worker itself runs (see `pipeline.ts`) — used whenever the
 * worker can't be trusted to answer: construction failure, a fatal
 * worker error, or a stuck-worker timeout. */
function settleWithFallback(entry: PendingRequest): void {
  try {
    entry.resolve(renderMarkdown(entry.source))
  } catch (error) {
    entry.reject(error)
  }
}

function handleStuckWorker(id: number): void {
  const entry = pending.get(id)
  if (!entry) return // already settled by a response that arrived just in time

  // The worker's internal state is unknown once one request has run this
  // long without answering (still working through a backlog? wedged?),
  // so it's replaced rather than reused. This is the one case where
  // terminating the worker is warranted (see the constant above) — not
  // routine cancellation, which never needs to touch the worker at all.
  worker?.terminate()
  worker = null

  // Every other request still waiting on the now-terminated worker would
  // otherwise wait out its own full timeout one by one; settle them all
  // immediately instead.
  for (const [pendingId, pendingEntry] of pending) {
    clearPending(pendingId)
    settleWithFallback(pendingEntry)
  }
}

function handleWorkerMessage(event: MessageEvent<RenderResponse>): void {
  const response = event.data
  const entry = pending.get(response.id)
  if (!entry) return // superseded by a stuck-worker timeout already, or an unknown id

  clearPending(response.id)

  if (response.ok) {
    entry.resolve(response.html)
    return
  }

  // The worker ran the same pipeline as the main thread and it threw —
  // rare, since both sides run identical code, but retried once here
  // rather than treated as unrecoverable.
  settleWithFallback(entry)
}

function handleWorkerFatalError(): void {
  // An uncaught error in the worker itself (construction succeeded but
  // the instance is now unusable), as opposed to a caught pipeline error
  // reported as a normal `ok: false` message (see `worker.ts`).
  workerConstructionFailed = true
  worker?.terminate()
  worker = null

  for (const [id, entry] of pending) {
    clearPending(id)
    settleWithFallback(entry)
  }
}

function ensureWorker(): Worker | null {
  if (workerConstructionFailed) return null
  if (worker) return worker

  try {
    const instance = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    })
    instance.addEventListener('message', handleWorkerMessage)
    instance.addEventListener('error', handleWorkerFatalError)
    worker = instance
    return instance
  } catch {
    // Worker construction itself threw (e.g. an unsupported
    // environment) — fall back to the main thread for this and every
    // later request.
    workerConstructionFailed = true
    return null
  }
}

/** Renders `source` for the given request `id`, via the worker when one
 * is available and healthy, or synchronously on the main thread
 * otherwise. Rejects only when neither the worker nor the main-thread
 * fallback could produce html for this input — i.e. the pipeline itself
 * is broken for it, not just the worker. */
export function renderInWorker(source: string, id: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const instance = ensureWorker()
    if (!instance) {
      settleWithFallback({ source, resolve, reject })
      return
    }

    pending.set(id, { source, resolve, reject })
    timeouts.set(
      id,
      setTimeout(() => handleStuckWorker(id), STUCK_WORKER_TIMEOUT_MS),
    )

    const request: RenderRequest = { id, source }
    instance.postMessage(request)
  })
}

/** Terminates the worker and abandons any in-flight requests. Exported
 * for Vite HMR teardown below; there is exactly one render worker for
 * the app's lifetime otherwise (this module is a singleton, not tied to
 * any component's mount/unmount), so this is not part of any component
 * lifecycle. */
export function terminateRenderWorker(): void {
  worker?.terminate()
  worker = null
  pending.clear()
  for (const timeout of timeouts.values()) clearTimeout(timeout)
  timeouts.clear()
}

// Without this, a dev-mode HMR update to this module (or anything it
// imports) would leave the old worker instance running forever — nothing
// else ever tears it down, since it outlives any single component.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    terminateRenderWorker()
  })
}

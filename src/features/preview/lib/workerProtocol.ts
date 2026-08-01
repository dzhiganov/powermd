/**
 * Message-protocol types shared between the main thread
 * (`renderWorkerClient.ts`) and the render worker (`worker.ts`).
 *
 * Deliberately free of any DOM- or WebWorker-only globals — `worker.ts`
 * is type-checked under a separate project (`tsconfig.worker.json`,
 * `lib: ["WebWorker"]`) from the rest of `src` (`tsconfig.app.json`,
 * `lib: [..., "DOM"]`), and those two `lib`s conflict if mixed in one
 * program. Keeping this file to plain data shapes means it type-checks
 * cleanly under either project, so both sides of the worker boundary can
 * import it without pulling one `lib` into the other's program.
 */

/** A render request sent to the worker. `id` is assigned by the caller
 * (see `model/preview.ts`) and echoed back unchanged in the response, so
 * the caller can match responses to requests and discard stale ones. */
export interface RenderRequest {
  id: number
  source: string
}

/** The worker's reply to a `RenderRequest` with the same `id`. `ok:
 * false` means the pipeline itself threw for this input (still a normal
 * message, not a worker-level failure) — see `worker.ts`. */
export type RenderResponse =
  { id: number; ok: true; html: string } | { id: number; ok: false; error: string }

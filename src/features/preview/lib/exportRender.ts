import { nextRenderRequestId, renderInWorker } from './renderWorkerClient'

/**
 * One-off markdown -> sanitized HTML render for export (Markdown -> HTML
 * download, "copy rendered HTML"), independent of the live preview's
 * 150ms debounce (`model/preview.ts`) so an export requested right after a
 * keystroke always reflects the exact current source, not whatever the
 * debounce last settled on. Goes through the same worker and the same
 * `pipeline.ts` (same `rehype-sanitize` schema) as the live preview — see
 * `renderWorkerClient.ts` — so exported HTML can never diverge from the
 * app's one sanitization boundary; nothing in `features/transfer` renders
 * markdown to HTML on its own. Ids come from the shared
 * `nextRenderRequestId` counter the live preview also uses, so a request
 * issued from here can never collide with one issued by `model/preview.ts`.
 */
export function renderMarkdownForExport(source: string): Promise<string> {
  return renderInWorker(source, nextRenderRequestId())
}

/**
 * Triggers the browser's native print dialog. Deliberately prints the
 * *currently-rendered* preview pane rather than doing a fresh render first:
 * the preview is already showing sanitized, up-to-date (within the 150ms
 * debounce) markdown output — see `features/preview/model/preview.ts` — so
 * printing it is a "what you see is what prints" guarantee, and needs no
 * separate render step or place to stash a throwaway render just for
 * printing.
 *
 * All of the "only the rendered document, unclipped, paginated properly"
 * behaviour lives entirely in CSS: the `print:` Tailwind variants on the
 * app's chrome components (toolbar, drawer, splitter, editor pane — see
 * `ARCHITECTURE.md` for where each lives) and the `@media print` overrides
 * in `features/preview/ui/Preview.vue`. This function's only job is to
 * invoke the dialog, kept as its own one-line module so it's trivially
 * stubbable for verification (`window.print` has no return value or
 * meaningful side effect to assert on otherwise).
 */
export function printDocument(): void {
  window.print()
}

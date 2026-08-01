/**
 * Copies plain text via the async Clipboard API where available, falling
 * back to the legacy `execCommand('copy')` path (still needed in some
 * embedded/older-browser contexts, or when the page isn't in an active/
 * focused tab, which the async API can refuse) so "copy" never silently
 * no-ops.
 */
export async function copyPlainText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  legacyCopy(text)
}

/**
 * Copies rendered HTML to the clipboard as a *rich* item — pasting into an
 * email client or word processor yields formatted content, not the literal
 * tag soup — via `ClipboardItem` with both `text/html` and a `text/plain`
 * fallback for targets that only accept plain text. `html` must already be
 * the sanitized pipeline output (see `features/preview/lib/exportRender.ts`)
 * — this function has no sanitization of its own, it only ever moves
 * already-safe HTML onto the clipboard. Falls back to a plain-text copy of
 * a tag-stripped rendering when `ClipboardItem` isn't available.
 */
export async function copyRichHtml(html: string): Promise<void> {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    const item = new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([htmlToPlainText(html)], { type: 'text/plain' }),
    })
    await navigator.clipboard.write([item])
    return
  }
  await copyPlainText(htmlToPlainText(html))
}

/** Strips tags for the plain-text fallback via a regex rather than
 * `innerHTML` + `textContent` — the latter would parse `html` into a live
 * (if detached) DOM node, which starts resource loads (e.g. an `<img>`
 * fetch) as a side effect of merely reading text out of already-sanitized
 * content. Not a security concern (the input is sanitized by the time it
 * reaches here either way), just an unnecessary side effect for what's
 * meant to be a inert plain-text fallback. */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function legacyCopy(text: string): void {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  try {
    document.execCommand('copy')
  } finally {
    document.body.removeChild(textarea)
  }
}

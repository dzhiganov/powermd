/**
 * Triggers a browser download of `blob` as `filename` via a throwaway
 * `<a download>` — the standard client-side-only technique, no backend
 * involved. The object URL is revoked right after the click dispatches
 * synchronously; the browser has already captured what it needs from the
 * blob by then.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function downloadText(text: string, filename: string, mimeType: string): void {
  downloadBlob(new Blob([text], { type: mimeType }), filename)
}

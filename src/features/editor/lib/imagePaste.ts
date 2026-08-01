import { EditorView } from '@codemirror/view'

import { toastRequested } from '@/shared/lib/toast'
import { formatMegabytes } from '@/shared/lib/formatBytes'

/**
 * Data-URI paste threshold, checked against the *image file's* byte size
 * (before base64 inflates it by ~33%). Chosen deliberately smaller than
 * the file-import warn threshold (`features/transfer`'s 5MB): a large
 * *imported file* is a one-time cost, but a large *embedded image* is
 * permanent per-edit overhead — every future keystroke's autosave
 * (the IndexedDB write, plus the synchronous localStorage mirror in
 * `features/documents/model/documents.ts`) re-serializes the entire
 * document, data URI included, for as long as the document exists. 2MB
 * keeps a typical pasted screenshot workable while refusing anything that
 * would make ordinary typing noticeably heavier to persist — refused
 * outright rather than warned-and-inserted-anyway, since there's no
 * "acknowledge and continue" that undoes the ongoing cost later.
 */
export const MAX_PASTE_IMAGE_BYTES = 2 * 1024 * 1024

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('Failed to read pasted image'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read pasted image'))
    reader.readAsDataURL(file)
  })
}

/**
 * CodeMirror extension: pasting an image (e.g. a screenshot from the OS
 * clipboard) embeds it as a markdown image with a `data:` URI at the
 * cursor, replacing CodeMirror's default no-op for an image clipboard item
 * (a plain-text editor has no text representation for one on its own).
 * Refuses — rather than silently truncating or hanging — above
 * `MAX_PASTE_IMAGE_BYTES`; see its doc comment for why refuse rather than
 * warn-and-insert-anyway. A CodeMirror extension (not a raw DOM listener
 * added/removed by hand) so its lifetime is tied to the `EditorView`
 * itself: destroying the view (see `useCodeMirror.ts`'s `onUnmounted`)
 * tears this down for free, with no separate cleanup path to forget.
 */
export const imagePasteHandler = EditorView.domEventHandlers({
  paste(event, view) {
    const files = Array.from(event.clipboardData?.files ?? [])
    const image = files.find((file) => file.type.startsWith('image/'))
    if (!image) return false

    event.preventDefault()

    if (image.size > MAX_PASTE_IMAGE_BYTES) {
      toastRequested({
        text: `Pasted image (${formatMegabytes(image.size)}) is larger than ${formatMegabytes(MAX_PASTE_IMAGE_BYTES)} and was not inserted — large embedded images bloat every future save.`,
        tone: 'warning',
      })
      return true
    }

    readAsDataUrl(image)
      .then((dataUrl) => {
        const { from, to } = view.state.selection.main
        const markdownImage = `![](${dataUrl})`
        view.dispatch({
          changes: { from, to, insert: markdownImage },
          selection: { anchor: from + markdownImage.length },
        })
      })
      .catch((error: unknown) => {
        console.error('[editor] failed to embed pasted image', error)
        toastRequested({ text: 'Could not read the pasted image.', tone: 'error' })
      })

    return true
  },
})

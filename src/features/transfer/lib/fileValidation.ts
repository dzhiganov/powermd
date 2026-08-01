/** Extensions this app can import as markdown/plain text. */
const ACCEPTED_EXTENSIONS = ['.md', '.markdown', '.txt']

export const ACCEPTED_EXTENSIONS_LIST = ACCEPTED_EXTENSIONS.join(', ')

/** Attribute value for the file picker's `<input accept>` — extensions
 * plus their common MIME types, so both drag-drop (checked by extension,
 * below) and the native picker (which some OS file dialogs filter by MIME
 * rather than extension) agree on what's importable. */
export const ACCEPTED_INPUT_ATTR = `${ACCEPTED_EXTENSIONS.join(',')},text/markdown,text/plain`

/**
 * Above this, the file still imports — rendering is off the main thread
 * (see `features/preview/lib/renderWorkerClient.ts`), so nothing here
 * literally hangs — but a toast warns that IndexedDB writes and CodeMirror
 * (which are *not* off the main thread) may feel sluggish. 5MB of markdown
 * source is already an extreme document, so this is a "heads up," not a
 * hard limit.
 */
export const IMPORT_WARN_BYTES = 5 * 1024 * 1024

export function hasAcceptedExtension(filename: string): boolean {
  const lower = filename.toLowerCase()
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

/** The NUL code point — technically valid UTF-8, but never legitimate in
 * hand-written markdown, so its presence is treated as a binary signal
 * even when the surrounding bytes otherwise decode cleanly. Built via
 * `fromCharCode` rather than a literal escape so the source file itself
 * never carries a raw NUL byte. */
const NUL = String.fromCharCode(0)

/**
 * Decodes a file's bytes as strict UTF-8 text, throwing rather than
 * silently degrading whenever the bytes aren't valid UTF-8 (the
 * `fatal: true` decoder option) — this, not the extension allow-list
 * above, is what actually catches a binary file that happens to carry an
 * accepted extension (a `.png` renamed to `.md`, say). A stray NUL byte is
 * rejected too — see `NUL` above.
 */
export async function readTextFileStrict(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    throw new Error(`"${file.name}" doesn't look like a text file and was not imported.`)
  }
  if (text.includes(NUL)) {
    throw new Error(`"${file.name}" doesn't look like a text file and was not imported.`)
  }
  return text
}

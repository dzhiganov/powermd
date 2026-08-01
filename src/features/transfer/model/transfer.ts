import { createEffect, createEvent, createStore, sample } from 'effector'

import { toastRequested } from '@/shared/lib/toast'
import { formatMegabytes } from '@/shared/lib/formatBytes'

import { installDropGuard } from '../lib/dragDrop'
import {
  ACCEPTED_EXTENSIONS_LIST,
  IMPORT_WARN_BYTES,
  hasAcceptedExtension,
  readTextFileStrict,
} from '../lib/fileValidation'
import { stripExtension, sanitizeFilename } from '../lib/filenames'
import { downloadText } from '../lib/download'
import { buildStandaloneHtml } from '../lib/htmlExport'
import { copyPlainText, copyRichHtml } from '../lib/clipboard'
import { printDocument } from '../lib/print'
import type { ExportDocument } from './types'

// --- Dependency injection -------------------------------------------------
//
// `transfer` must not import `preview` (or any other feature) directly —
// only via `app/wiring.ts`, the one place allowed to know every feature
// exists (see `ARCHITECTURE.md`). The one thing HTML/PDF export needs from
// outside this feature — rendering markdown to sanitized HTML — is
// injected once via `initTransfer`, the same shape `initDocuments` already
// uses for the editor's welcome text in `features/documents/model/documents.ts`.

export interface TransferDeps {
  /** Same pipeline + sanitize schema as the live preview — see
   * `features/preview/lib/exportRender.ts`. */
  renderMarkdown: (source: string) => Promise<string>
}

let deps: TransferDeps | null = null

function renderForExport(source: string): Promise<string> {
  if (deps === null) {
    // Only reachable if an export effect somehow fires before
    // `initTransfer` runs from `wiring.ts` at startup — a programming
    // error, not a runtime condition a user can hit.
    return Promise.reject(new Error('[transfer] initTransfer was not called'))
  }
  return deps.renderMarkdown(source)
}

// --- Drag-and-drop + file picker import -----------------------------------

/** Fired from `ui/ImportButton.vue`'s hidden `<input type="file">`. */
export const filePickerFilesSelected = createEvent<File[]>()
/** Internal: unifies the drop and file-picker paths into one stream of
 * files to import. */
const filesReceived = createEvent<File[]>()
/** One element of `filesReceived`, expanded via the `.watch` below so each
 * file gets its own effect run and its own success/failure outcome —
 * `sample` has no built-in "fan one array-payload event out into N target
 * calls," so this is the one place in this model that uses `.watch` for
 * something other than a side effect, translating a 1-to-N clock instead. */
const fileReceived = createEvent<File>()

filesReceived.watch((files) => {
  files.forEach((file) => fileReceived(file))
})

sample({ clock: filePickerFilesSelected, target: filesReceived })

const dragActiveChanged = createEvent<boolean>()
/** Drives the drop-target affordance — see `ui/DropOverlay.vue`. */
export const $isDraggingFile = createStore(false).on(dragActiveChanged, (_, active) => active)

const importFileFx = createEffect(
  async (file: File): Promise<{ title: string; content: string }> => {
    if (!hasAcceptedExtension(file.name)) {
      throw new Error(
        `"${file.name}" is not a supported file type — only ${ACCEPTED_EXTENSIONS_LIST} can be imported.`,
      )
    }
    const content = await readTextFileStrict(file)
    if (file.size > IMPORT_WARN_BYTES) {
      toastRequested({
        text: `"${file.name}" is a large file (${formatMegabytes(file.size)}) — it was imported, but typing may feel slower than usual.`,
        tone: 'warning',
      })
    }
    return { title: stripExtension(file.name), content }
  },
)

sample({ clock: fileReceived, target: importFileFx })

/** Output event: a file has been read, validated, and is ready to become a
 * new document. `wiring.ts` samples this into `documentImported`
 * (`@/features/documents`'s public API) — see that file for why the
 * connection lives there instead of this feature importing `documents`
 * directly. */
export const markdownFileImported = createEvent<{ title: string; content: string }>()

sample({ clock: importFileFx.doneData, target: markdownFileImported })

sample({
  clock: importFileFx.fail,
  fn: ({ error }): { text: string; tone: 'error' } => ({
    text: error instanceof Error ? error.message : 'Could not import file.',
    tone: 'error',
  }),
  target: toastRequested,
})

// --- Export source (the active document, projected down) ------------------

/** Input event: `wiring.ts` samples `@/features/documents`'s
 * `$activeDocument` into this, projected down to just `{ title, content }`
 * — see `model/types.ts`'s `ExportDocument` doc comment for why. */
export const exportSourceChanged = createEvent<ExportDocument | null>()
const $exportSource = createStore<ExportDocument | null>(null).on(
  exportSourceChanged,
  (_, doc) => doc,
)

// --- Export commands --------------------------------------------------------

export const exportMarkdownRequested = createEvent()
export const exportHtmlRequested = createEvent()
export const exportPdfRequested = createEvent()
export const copyMarkdownRequested = createEvent()
export const copyHtmlRequested = createEvent()

const exportMarkdownFx = createEffect((doc: ExportDocument): void => {
  downloadText(doc.content, `${sanitizeFilename(doc.title)}.md`, 'text/markdown;charset=utf-8')
})

const exportHtmlFx = createEffect(async (doc: ExportDocument): Promise<void> => {
  const html = await renderForExport(doc.content)
  const standalone = buildStandaloneHtml(doc.title, html)
  downloadText(standalone, `${sanitizeFilename(doc.title)}.html`, 'text/html;charset=utf-8')
})

const exportPdfFx = createEffect((): void => {
  printDocument()
})

const copyMarkdownFx = createEffect((doc: ExportDocument): Promise<void> =>
  copyPlainText(doc.content),
)

const copyHtmlFx = createEffect(async (doc: ExportDocument): Promise<void> => {
  const html = await renderForExport(doc.content)
  await copyRichHtml(html)
})

function isExportDocument(doc: ExportDocument | null): doc is ExportDocument {
  return doc !== null
}

sample({
  clock: exportMarkdownRequested,
  source: $exportSource,
  filter: isExportDocument,
  target: exportMarkdownFx,
})
sample({
  clock: exportHtmlRequested,
  source: $exportSource,
  filter: isExportDocument,
  target: exportHtmlFx,
})
sample({ clock: exportPdfRequested, target: exportPdfFx })
sample({
  clock: copyMarkdownRequested,
  source: $exportSource,
  filter: isExportDocument,
  target: copyMarkdownFx,
})
sample({
  clock: copyHtmlRequested,
  source: $exportSource,
  filter: isExportDocument,
  target: copyHtmlFx,
})

// --- Export/copy feedback ---------------------------------------------------

sample({
  clock: exportHtmlFx.fail,
  fn: (): { text: string; tone: 'error' } => ({ text: 'Could not export HTML.', tone: 'error' }),
  target: toastRequested,
})
sample({
  clock: copyMarkdownFx.fail,
  fn: (): { text: string; tone: 'error' } => ({
    text: 'Could not copy markdown to the clipboard.',
    tone: 'error',
  }),
  target: toastRequested,
})
sample({
  clock: copyHtmlFx.fail,
  fn: (): { text: string; tone: 'error' } => ({
    text: 'Could not copy HTML to the clipboard.',
    tone: 'error',
  }),
  target: toastRequested,
})
sample({
  clock: copyMarkdownFx.done,
  fn: (): { text: string; tone: 'info' } => ({
    text: 'Markdown copied to clipboard.',
    tone: 'info',
  }),
  target: toastRequested,
})
sample({
  clock: copyHtmlFx.done,
  fn: (): { text: string; tone: 'info' } => ({ text: 'HTML copied to clipboard.', tone: 'info' }),
  target: toastRequested,
})

// --- Init ------------------------------------------------------------------

let uninstallDropGuard: (() => void) | null = null

/** Called once from `wiring.ts`: supplies the renderer this feature can't
 * import directly, and installs the window-level drag/drop guard (see
 * `lib/dragDrop.ts`) for the app's lifetime — the same "plain function
 * called once at startup, no component lifecycle involved" shape as
 * `initDocuments`/`initScrollSync`. */
export function initTransfer(options: TransferDeps): void {
  deps = options
  uninstallDropGuard?.()
  uninstallDropGuard = installDropGuard({
    onDragActive: (active) => dragActiveChanged(active),
    onFilesDropped: (files) => filesReceived(files),
  })
}

// Without this, a dev-mode HMR update to this module (or anything it
// imports) would leave a second, stacked set of window-level drag/drop
// listeners running forever — nothing else ever tears them down, since
// they outlive any single component. Mirrors
// `features/preview/lib/renderWorkerClient.ts`'s identical use of
// `import.meta.hot.dispose` for the render worker, another app-lifetime
// singleton with no component to hang cleanup off of. The
// `uninstallDropGuard?.()` inside `initTransfer` above is a second,
// belt-and-suspenders guard against ever double-installing regardless of
// HMR dispose ordering.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    uninstallDropGuard?.()
    uninstallDropGuard = null
  })
}

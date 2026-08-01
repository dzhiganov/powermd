/** The minimal shape `transfer` needs from the active document — title for
 * filenames, content for the actual export. Deliberately narrower than
 * `documents`' `MarkdownDocument` (no `id`/timestamps): this feature never
 * needs a document's identity, only what it's exporting, and this is the
 * type `wiring.ts` projects `@/features/documents`'s `$activeDocument`
 * down to before feeding it in — see `model/transfer.ts`. */
export interface ExportDocument {
  title: string
  content: string
}

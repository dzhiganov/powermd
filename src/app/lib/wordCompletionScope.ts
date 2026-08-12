/**
 * The pure "should word completion be active in the editor right now"
 * decision, split into its own zero-import module for the same reason
 * `documentsSearchShortcut.ts`'s own `lib/documentsSearchShortcut.ts`
 * sibling is: this project's `vitest.config.ts` runs with no jsdom and no
 * Vue plugin (see that file's own comment), so a test file can only safely
 * import modules with no transitive `@/features/**` chain. `../wiring.ts`
 * (the one caller of this function) imports `@/features/settings` and
 * `@/features/documents` directly — importing this function from a test
 * alongside that chain would risk pulling both in transitively; keeping it
 * here, with no imports of its own, means `wordCompletionScope.test.ts` can
 * import *only* this file.
 *
 * Combines three independent pieces of context — none of which either
 * `editor` or `settings` is allowed to fully resolve on its own — into the
 * one already-decided boolean `wiring.ts` pushes into `editor`'s
 * `wordCompletionChanged` (see that file's own "settings <-> editor /
 * documents" section):
 *
 *   - `globalEnabled`: `settings`' persisted "Word completion" toggle
 *     (`$wordCompletionEnabled` in `features/settings/model/
 *     editorPreferences.ts`) — off overrides everything else below.
 *   - `excludedFolderIds`: `settings`' persisted per-folder exclusion list
 *     (`$wordCompletionExcludedFolderIds`, same file) — opaque folder ids,
 *     `settings` has no notion of what a folder otherwise contains.
 *   - `documentFolderId`: the CURRENTLY OPEN document's folder, `null` for
 *     a document at the root — `documents`-owned
 *     (`features/documents/model/types.ts`'s `MarkdownDocument.folderId`),
 *     which `editor` may not read (see `features/editor/lib/
 *     wikiLinkCompletion.ts`'s own doc comment on the same "editor never
 *     imports documents" rule) and `settings` may not either (see
 *     `features/documents/ui/DocumentDrawer.vue`'s note that `documents`
 *     and `settings` never import each other's internals).
 *
 * `editor` itself never calls this or knows folders exist at all — it only
 * ever receives the single resulting boolean via `wordCompletionChanged`,
 * same as every other settings-owned preference it mirrors
 * (`$lineWrapEnabled`, `$spellcheckSettings`, ...).
 */
export interface WordCompletionScopeInput {
  /** `settings`' global "Word completion" toggle. */
  readonly globalEnabled: boolean
  /** `settings`' persisted list of excluded folder ids. */
  readonly excludedFolderIds: readonly string[]
  /** The open document's folder id, or `null` if it's at the root. */
  readonly documentFolderId: string | null
}

/**
 * A document at the root (`documentFolderId: null`) can never be excluded
 * by folder — there is no folder to exclude it FROM — so it always gets
 * suggestions whenever the global toggle is on, regardless of what's in
 * `excludedFolderIds`. This also covers, for free, the "excluded id refers
 * to a folder that's since been deleted" case: deleting a folder moves
 * every document that was inside it to the root
 * (`features/documents/model/documents.ts`'s `deleteFolderFx`/
 * `deleteFolderAndOrphanDocuments`), so a document that used to be
 * (potentially) excluded by that folder's id has a `documentFolderId` of
 * `null` from that point on — the stale id sitting harmlessly in
 * `excludedFolderIds` (until the user notices its checkbox is gone from
 * Settings and never worries about it again) can no longer match any real
 * document, without this function needing to know the folder was ever
 * deleted at all.
 */
export function isWordCompletionActive(input: WordCompletionScopeInput): boolean {
  if (!input.globalEnabled) return false
  if (input.documentFolderId === null) return true
  return !input.excludedFolderIds.includes(input.documentFolderId)
}

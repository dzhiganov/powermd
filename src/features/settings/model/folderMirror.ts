import { createEvent, createStore } from 'effector'

/**
 * `settings`' own mirror of `features/documents`' live folder list — same
 * "acting feature keeps its own mirror, fed by `src/app/wiring.ts`" shape
 * as `features/editor`'s `$wikiLinkDocuments`
 * (`features/editor/model/editorEvents.ts`). `settings` and `documents`
 * never import each other's internals (see `features/documents/ui/
 * DocumentDrawer.vue`'s own note on that same rule, for `showTooltips`/
 * `side` coming in as props instead of a direct import) — this is what lets
 * the Settings -> Editor category's per-folder word-completion exclusion
 * list (`ui/SettingsModal.vue`) render real folder names without either
 * feature reaching into the other.
 *
 * Only `{ id, name }` — the settings UI never needs a folder's
 * `createdAt`/`syncDirPath`, just enough to label a checkbox and toggle it
 * by id (`editorPreferences.ts`'s `$wordCompletionExcludedFolderIds` stores
 * only the id). Reflects the *live* list — a folder created, renamed, or
 * deleted elsewhere while Settings is open updates this the same way
 * `$wikiLinkDocuments` stays live for the `[[` menu, via `wiring.ts`
 * sampling straight off `documents`' `$folders`, not a one-time snapshot.
 */
export interface DocumentFolder {
  id: string
  name: string
}

export const documentFoldersChanged = createEvent<DocumentFolder[]>()
export const $documentFolders = createStore<DocumentFolder[]>([]).on(
  documentFoldersChanged,
  (_, folders) => folders,
)

import { createEvent, createStore } from 'effector'
import type { EditorView } from '@codemirror/view'

/**
 * Internal to the `editor` feature — deliberately never exported via
 * `index.ts`. Holds the live CodeMirror `EditorView` so sibling UI within
 * this same feature (`ui/FormattingToolbar.vue`) can dispatch formatting
 * transactions without each needing its own `onViewReady` wiring through
 * `Editor.vue`. Mirrors the `$editorScrollHandle` pattern
 * (`model/scrollHandle.ts`), but exposes the view itself rather than a
 * narrow wrapper: formatting commands are one-off imperative dispatches
 * (`lib/formatting.ts`) against the real `EditorView`, not a fixed small
 * interface like scroll position.
 */
export const editorViewMounted = createEvent<EditorView>()
export const editorViewDestroyed = createEvent()

export const $editorView = createStore<EditorView | null>(null)
  .on(editorViewMounted, (_, view) => view)
  .reset(editorViewDestroyed)

import { createEvent, createStore } from 'effector'

import type { EditorScrollHandle } from '../lib/scrollHandle'

export type { EditorScrollHandle, EditorLineBlock } from '../lib/scrollHandle'

/** Fired once the editor's CodeMirror view has been created (see
 * `ui/Editor.vue`), carrying a handle scroll-sync (or any future
 * consumer) can use without reaching into CodeMirror internals. */
export const editorScrollHandleMounted = createEvent<EditorScrollHandle>()
/** Fired when the view is destroyed, so consumers stop trying to use a
 * dead handle. In practice the view lives for the app's lifetime (see
 * `useCodeMirror.ts`), but this keeps the store honest regardless. */
export const editorScrollHandleUnmounted = createEvent()

export const $editorScrollHandle = createStore<EditorScrollHandle | null>(null)
  .on(editorScrollHandleMounted, (_, handle) => handle)
  .on(editorScrollHandleUnmounted, () => null)

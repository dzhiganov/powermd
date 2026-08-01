<script setup lang="ts">
import { onUnmounted, ref } from 'vue'

import { useCodeMirror } from '../lib/useCodeMirror'
import { createEditorScrollHandle } from '../lib/scrollHandle'
import { $content, contentChanged, loadContent } from '../model/content'
import { editorScrollHandleMounted, editorScrollHandleUnmounted } from '../model/scrollHandle'

defineProps<{
  /** Constrains and centres `.cm-content` to a comfortable reading width
   * instead of stretching it edge-to-edge — only meant for single-pane
   * modes, see `layout/ui/AppShell.vue`. */
  centered?: boolean
}>()

const container = ref<HTMLDivElement | null>(null)

const { loadDocument } = useCodeMirror(container, {
  // Read once, synchronously, at mount. If the restored/seeded document has
  // already been pushed into `$content` by then, the view opens with it;
  // otherwise it opens empty and the `loadContent` subscription below fills
  // it the moment IndexedDB resolves.
  doc: $content.getState(),
  onChange: (value) => contentChanged(value),
  // Wraps the raw `EditorView` into the narrow `EditorScrollHandle` shape
  // right here, so nothing outside this feature ever touches CodeMirror
  // directly — see `lib/scrollHandle.ts`.
  onViewReady: (view) => editorScrollHandleMounted(createEditorScrollHandle(view)),
  onViewDestroy: () => editorScrollHandleUnmounted(),
})

// A programmatic document load (initial restore, or switching documents in
// the drawer) rebuilds the editor state: undo history discarded, cursor and
// scroll reset to the top, and — crucially — no `contentChanged`, so
// loading a document never flags it unsaved. `loadContent` only fires for
// real loads, never on keystrokes, so the view is never rebuilt mid-edit.
const subscription = loadContent.watch((value) => loadDocument(value))
onUnmounted(subscription.unsubscribe)
</script>

<template>
  <div ref="container" class="h-full min-w-0" :class="{ 'editor-centered': centered }" />
</template>

<style scoped>
/*
 * CodeMirror injects `.cm-content` itself (never part of this component's
 * own rendered template), so `:deep()` is required to reach it. It's a
 * flex item inside `.cm-scroller` with `flex-grow: 2` by default — that
 * still leaves room to cap its width, because `max-width` is applied as a
 * hard clamp *after* flex resolution regardless of `flex-grow`, and the
 * `margin-inline: auto` centres it the same way it would on a plain block
 * element: flexbox gives auto margins first claim on any leftover space
 * on the main axis. Verified in the browser (see task report) that this
 * doesn't disturb CodeMirror's own line-wrapping or cursor-coordinate
 * measurements, since both are computed from the element's actual
 * rendered box, not from `flex-grow`/`flex-basis`.
 */
.editor-centered :deep(.cm-content) {
  max-width: 75ch;
  margin-inline: auto;
}
</style>

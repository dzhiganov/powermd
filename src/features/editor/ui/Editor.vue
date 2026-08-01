<script setup lang="ts">
import { ref, watch } from 'vue'
import { useUnit } from 'effector-vue/composition'

import { useCodeMirror } from '../lib/useCodeMirror'
import { createEditorScrollHandle } from '../lib/scrollHandle'
import { $content, contentChanged } from '../model/content'
import { editorScrollHandleMounted, editorScrollHandleUnmounted } from '../model/scrollHandle'

defineProps<{
  /** Constrains and centres `.cm-content` to a comfortable reading width
   * instead of stretching it edge-to-edge — only meant for single-pane
   * modes, see `layout/ui/AppShell.vue`. */
  centered?: boolean
}>()

const container = ref<HTMLDivElement | null>(null)
const content = useUnit($content)

const { setContent } = useCodeMirror(container, {
  doc: content.value,
  onChange: (value) => contentChanged(value),
  // Wraps the raw `EditorView` into the narrow `EditorScrollHandle` shape
  // right here, so nothing outside this feature ever touches CodeMirror
  // directly — see `lib/scrollHandle.ts`.
  onViewReady: (view) => editorScrollHandleMounted(createEditorScrollHandle(view)),
  onViewDestroy: () => editorScrollHandleUnmounted(),
})

// Keeps the editor in sync with `$content` when it changes from outside
// (e.g. a future "open document" action). `setContent` itself no-ops
// when the value already matches the editor's document, which is what
// keeps typing from looping back into a redundant dispatch.
watch(content, (value) => {
  setContent(value)
})
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

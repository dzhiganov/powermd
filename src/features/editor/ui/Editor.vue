<script setup lang="ts">
import { ref, watch } from 'vue'
import { useUnit } from 'effector-vue/composition'

import { useCodeMirror } from '../lib/useCodeMirror'
import { $content, contentChanged } from '../model/content'

const container = ref<HTMLDivElement | null>(null)
const content = useUnit($content)

const { setContent } = useCodeMirror(container, {
  doc: content.value,
  onChange: (value) => contentChanged(value),
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
  <div ref="container" class="h-full min-w-0" />
</template>

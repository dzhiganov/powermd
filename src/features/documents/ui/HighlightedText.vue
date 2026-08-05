<script setup lang="ts">
import { computed } from 'vue'

// Highlights every case-insensitive occurrence of `query` inside `text` —
// used by the sidebar search results (`DocumentDrawer.vue`) to show *why*
// a document matched. Deliberately built from plain text segments run
// through Vue's own `{{ }}` interpolation (always-escaping), never
// `v-html` or any other string-to-markup path: `text` here is untrusted
// document content (a title or a raw markdown excerpt, verbatim, not
// sanitized HTML the way `preview`'s rendered output is) — feeding it
// through `v-html` would reopen exactly the injection surface
// `rehype-sanitize` exists to close for the *rendered* preview, just via a
// second, unguarded path. A malicious document containing literal
// `<img src=x onerror=alert(1)>` in its content and a matching search
// query must render as that literal text with the matched substring
// wrapped, never as a parsed `<img>` element.
const props = defineProps<{ text: string; query: string }>()

interface Segment {
  text: string
  match: boolean
}

const segments = computed<Segment[]>(() => {
  const query = props.query.trim()
  if (query === '') return [{ text: props.text, match: false }]

  const lowerText = props.text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const result: Segment[] = []
  let cursor = 0

  while (cursor <= props.text.length) {
    const index = lowerText.indexOf(lowerQuery, cursor)
    if (index === -1) {
      result.push({ text: props.text.slice(cursor), match: false })
      break
    }
    if (index > cursor) result.push({ text: props.text.slice(cursor, index), match: false })
    result.push({ text: props.text.slice(index, index + query.length), match: true })
    cursor = index + query.length
  }
  return result
})
</script>

<template>
  <template v-for="(segment, index) in segments" :key="index">
    <mark v-if="segment.match" class="search-highlight">{{ segment.text }}</mark>
    <template v-else>{{ segment.text }}</template>
  </template>
</template>

<style scoped>
.search-highlight {
  border-radius: 2px;
  background: color-mix(in oklab, var(--color-primary) 35%, transparent);
  color: inherit;
}
</style>

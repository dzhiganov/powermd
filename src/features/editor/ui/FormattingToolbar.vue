<script setup lang="ts">
import { ref } from 'vue'
import { useUnit } from 'effector-vue/composition'
import {
  BoldIcon,
  ItalicIcon,
  LinkIcon,
  CodeBracketIcon,
  CodeBracketSquareIcon,
  ListBulletIcon,
  NumberedListIcon,
  ChatBubbleLeftIcon,
  TableCellsIcon,
  H2Icon,
} from '@heroicons/vue/24/outline'
import type { Component } from 'vue'
import type { EditorView } from '@codemirror/view'

import { $showTooltips } from '@/features/settings'

import { $editorView } from '../model/view'
import {
  toggleWrapInline,
  toggleLink,
  toggleCodeBlock,
  toggleBulletList,
  toggleNumberedList,
  toggleQuote,
  toggleHeading,
  insertTable,
} from '../lib/formatting'

// Only a derived boolean goes through Vue's reactivity (`useUnit`) — piping
// the raw `EditorView` class instance through a `ref` makes Vue's
// `UnwrapRef` structurally decompose it, which then no longer satisfies
// CodeMirror's own `EditorView` type (this is exactly why
// `model/scrollHandle.ts` wraps the view in a plain interface instead of
// exposing it directly). `runAction` below reads the live instance
// imperatively off the store instead, at the moment it's actually needed.
const hasView = useUnit($editorView.map((view) => view !== null))
const showTooltips = useUnit($showTooltips)

interface ToolbarAction {
  id: string
  label: string
  icon: Component
  run: (target: EditorView) => void
}

const actions: ToolbarAction[] = [
  { id: 'bold', label: 'Bold', icon: BoldIcon, run: (v) => toggleWrapInline(v, '**') },
  { id: 'italic', label: 'Italic', icon: ItalicIcon, run: (v) => toggleWrapInline(v, '*') },
  { id: 'link', label: 'Link', icon: LinkIcon, run: (v) => toggleLink(v) },
  {
    id: 'inline-code',
    label: 'Inline code',
    icon: CodeBracketIcon,
    run: (v) => toggleWrapInline(v, '`'),
  },
  {
    id: 'code-block',
    label: 'Code block',
    icon: CodeBracketSquareIcon,
    run: (v) => toggleCodeBlock(v),
  },
  {
    id: 'bullet-list',
    label: 'Bullet list',
    icon: ListBulletIcon,
    run: (v) => toggleBulletList(v),
  },
  {
    id: 'numbered-list',
    label: 'Numbered list',
    icon: NumberedListIcon,
    run: (v) => toggleNumberedList(v),
  },
  { id: 'quote', label: 'Quote', icon: ChatBubbleLeftIcon, run: (v) => toggleQuote(v) },
  { id: 'table', label: 'Table', icon: TableCellsIcon, run: (v) => insertTable(v) },
  { id: 'heading', label: 'Heading', icon: H2Icon, run: (v) => toggleHeading(v) },
]

// WAI-ARIA "toolbar" pattern: a roving tabindex keeps this 10-button row
// out of the page's Tab order as 10 separate stops — only the "current"
// button is ever tabbable; Left/Right/Home/End move it. `document.tab`
// order for the rest of the app stays exactly one stop at this toolbar's
// position either way.
const focusedIndex = ref(0)
const buttonRefs = ref<(HTMLButtonElement | null)[]>([])

function setButtonRef(el: unknown, index: number) {
  buttonRefs.value[index] = el instanceof HTMLButtonElement ? el : null
}

function focusIndex(index: number) {
  const clamped = (index + actions.length) % actions.length
  focusedIndex.value = clamped
  buttonRefs.value[clamped]?.focus()
}

function handleKeydown(event: KeyboardEvent, index: number) {
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    focusIndex(index + 1)
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    focusIndex(index - 1)
  } else if (event.key === 'Home') {
    event.preventDefault()
    focusIndex(0)
  } else if (event.key === 'End') {
    event.preventDefault()
    focusIndex(actions.length - 1)
  }
}

function runAction(action: ToolbarAction, index: number) {
  focusedIndex.value = index
  const view = $editorView.getState()
  if (view) action.run(view)
}
</script>

<template>
  <div
    class="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-base-300 bg-base-200 px-2 py-1 print:hidden"
    role="toolbar"
    aria-label="Formatting"
  >
    <button
      v-for="(action, index) in actions"
      :key="action.id"
      :ref="(el) => setButtonRef(el, index)"
      type="button"
      class="btn btn-ghost btn-xs btn-square"
      :tabindex="focusedIndex === index ? 0 : -1"
      :aria-label="action.label"
      :title="showTooltips ? action.label : undefined"
      :disabled="!hasView"
      @click="runAction(action, index)"
      @keydown="handleKeydown($event, index)"
    >
      <component :is="action.icon" class="h-4 w-4" />
    </button>
  </div>
</template>

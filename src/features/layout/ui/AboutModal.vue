<script setup lang="ts">
import { ref } from 'vue'
import { useUnit } from 'effector-vue/composition'
import { XMarkIcon } from '@heroicons/vue/24/outline'

import { useDialogFocusTrap } from '@/shared/lib/useDialog'
import { ink } from '@/shared/lib/ink'

import { $aboutOpen, aboutClosed } from '../model/dialogs'

const open = useUnit($aboutOpen)
const dialogRef = ref<HTMLElement | null>(null)
const firstControlRef = ref<HTMLElement | null>(null)
const { trapFocus } = useDialogFocusTrap(dialogRef, open, firstControlRef)

// Same token/formula as `Preview.vue`'s prose link colour and
// `features/editor/lib/theme.ts`'s link/URL tokens — `--md-accent` (the
// TEXT/focus-ring role), not DaisyUI's fixed-blue `--color-info` (see
// `GitHubSyncPanel.vue`'s `infoInk`, which reads `--color-info` directly
// and measures 1.76:1 — the bug this deliberately avoids repeating).
const linkColor = ink('--md-accent')

interface Faq {
  question: string
  answer: string
}

const faqs: Faq[] = [
  {
    question: 'Where are my documents stored?',
    answer:
      "In your browser, using IndexedDB. Nothing is sent anywhere unless you connect GitHub sync. Clearing this site's browser data deletes them.",
  },
  {
    question: 'Does it work offline?',
    answer:
      "Yes. Install it and it opens and edits with no network. Pending syncs wait until you're back online.",
  },
  {
    question: 'What does GitHub sync do?',
    answer:
      "It pushes your documents and folders to a repository you choose. One-way only: this app writes to GitHub and never reads back. Editing a file on GitHub won't change it here, and a later push may overwrite it.",
  },
  {
    question: 'If I delete a document, does it disappear from GitHub?',
    answer:
      'No. Deletions stay local, deliberately. Remove the file on GitHub yourself if you want it gone.',
  },
  {
    question: 'Where does my GitHub token go?',
    answer:
      "Into your browser's local storage, and into the authorization header of requests to GitHub. It is never logged, never placed in a URL, and never sent anywhere else. Local storage is readable by any script on this origin, so treat it like any other credential your browser holds. Disconnect revokes it.",
  },
  {
    question: 'What Markdown is supported?',
    answer:
      'GitHub Flavored Markdown — tables, task lists, strikethrough, autolinks — plus syntax highlighting and Mermaid diagrams. HTML in your document is sanitized before it renders.',
  },
  {
    question: 'Who made this?',
    answer: 'Dmitriy Zhiganov.',
  },
]

interface AboutLink {
  label: string
  href: string
}

// These three URLs are exact — never altered/normalised/stripped.
const links: AboutLink[] = [
  { label: 'Website', href: 'https://www.dimazhiganov.dev/' },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/in/dmitriy-zhiganov/' },
  { label: 'YouTube', href: 'https://www.youtube.com/@d.zhiganov' },
]
</script>

<template>
  <div
    v-if="open"
    ref="dialogRef"
    class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 print:hidden"
    role="dialog"
    aria-modal="true"
    aria-labelledby="about-dialog-title"
    tabindex="-1"
    @keydown.esc="aboutClosed()"
    @keydown.tab="trapFocus"
  >
    <div class="flex max-h-[85vh] w-full max-w-md flex-col rounded-box bg-base-100 shadow-xl">
      <div class="flex shrink-0 items-center justify-between p-5 pb-0">
        <h2 id="about-dialog-title" class="text-base font-semibold text-base-content">About</h2>
        <button
          ref="firstControlRef"
          type="button"
          class="btn btn-ghost btn-sm btn-square"
          aria-label="Close about"
          @click="aboutClosed()"
        >
          <XMarkIcon class="h-4 w-4" />
        </button>
      </div>

      <div class="mt-4 min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        <p class="text-sm text-base-content/70">
          A Markdown editor that runs entirely in your browser.
        </p>

        <dl class="mt-4 flex flex-col gap-4">
          <div v-for="faq in faqs" :key="faq.question">
            <dt class="text-sm font-semibold text-base-content">{{ faq.question }}</dt>
            <dd class="mt-1 text-sm text-base-content/70">{{ faq.answer }}</dd>
          </div>
        </dl>

        <div class="mt-5 flex flex-wrap gap-x-4 gap-y-2 border-t border-base-300 pt-4">
          <a
            v-for="link in links"
            :key="link.label"
            :href="link.href"
            target="_blank"
            rel="noopener noreferrer"
            class="text-sm underline"
            :style="{ color: linkColor }"
          >
            {{ link.label }}
          </a>
        </div>
      </div>
    </div>
  </div>
</template>

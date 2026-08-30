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
    question: 'Is this open source?',
    answer:
      'Yes — MIT licensed, and the full source is on GitHub. Issues and pull requests are welcome.',
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

// These URLs are exact — never altered/normalised/stripped. Source first:
// it is the one link that is about this app rather than about its author,
// and an open-source project should say where its source is before it says
// anything else.
const links: AboutLink[] = [
  { label: 'Source on GitHub', href: 'https://github.com/dzhiganov/powermd' },
  { label: 'Website', href: 'https://www.dimazhiganov.dev/' },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/in/dmitriy-zhiganov/' },
  { label: 'YouTube', href: 'https://www.youtube.com/@d.zhiganov' },
]
</script>

<template>
  <!-- Full-window rather than a centred panel: this covers the whole
       viewport, so there is no scrim and no rounding — the app behind it is
       hidden entirely rather than dimmed. Still a modal dialog, not a route
       (focus trap, Escape, `aria-modal`), so the editor keeps its state and
       the URL keeps meaning what it meant. -->
  <div
    v-if="open"
    ref="dialogRef"
    class="about-panel fixed inset-0 z-[60] flex flex-col print:hidden"
    role="dialog"
    aria-modal="true"
    aria-labelledby="about-dialog-title"
    tabindex="-1"
    @keydown.esc="aboutClosed()"
    @keydown.tab="trapFocus"
  >
    <!-- 46px to match the app header exactly, so the close button lands
         where the eye already expects the header controls to be rather than
         shifting the whole chrome when this opens. -->
    <div class="flex h-[46px] shrink-0 items-center justify-between border-b border-base-300 px-3">
      <h2 id="about-dialog-title" class="text-xs font-semibold text-base-content">About</h2>
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

    <div class="min-h-0 flex-1 overflow-y-auto">
      <!-- The surface is full-window; the text is not. Running prose set
           across a 1280px+ viewport is unreadable, so the column stays at a
           normal measure and centres, exactly as the editor's own reading
           width does. -->
      <div class="mx-auto w-full max-w-2xl px-6 py-10">
        <p class="text-xs text-base-content/70">
          A Markdown editor that runs entirely in your browser.
        </p>

        <dl class="mt-8 flex flex-col gap-6">
          <div v-for="faq in faqs" :key="faq.question">
            <dt class="text-xs font-semibold text-base-content">{{ faq.question }}</dt>
            <dd class="mt-1.5 text-xs leading-relaxed text-base-content/70">{{ faq.answer }}</dd>
          </div>
        </dl>

        <div class="mt-8 flex flex-wrap gap-x-5 gap-y-2 border-t border-base-300 pt-5">
          <a
            v-for="link in links"
            :key="link.label"
            :href="link.href"
            target="_blank"
            rel="noopener noreferrer"
            class="text-xs underline"
            :style="{ color: linkColor }"
          >
            {{ link.label }}
          </a>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * Same glass surface as `SettingsModal.vue`'s `.settings-panel`, and the
 * same two-rule split: the 78% tint is what guarantees contrast on its own,
 * and `backdrop-filter` is a decorative layer on top that can be removed
 * without affecting legibility.
 *
 * Being full-window, this has NO scrim behind it — it composites directly
 * over the editor, so the worst-case backdrop really is arbitrary document
 * content. 78% was derived against exactly that: composited over pure white
 * and pure black, the binding case is the `/70` answer text, which holds
 * above the 4.5:1 floor in both themes. Measured, not assumed.
 */
.about-panel {
  background-color: color-mix(in srgb, var(--color-base-100) 78%, transparent);
  /* No gradient — it banded into visible diagonal lines. See
     `SettingsModal.vue`'s `.settings-panel` for the arithmetic; this panel
     is full-window, so it spans even further and bands even wider. */
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  backdrop-filter: blur(24px) saturate(180%);
}

@media (prefers-reduced-transparency: reduce) {
  .about-panel {
    background-color: var(--color-base-100);
    background-image: none;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
}

/*
 * SOFT CONTRAST COMPENSATION — same fix, same derivation, as
 * `SettingsModal.vue`'s `.settings-panel` override of its own (identical)
 * glass panel: softening `--color-base-100` (see `app/styles/main.css`'s
 * `[data-soft='true']` blocks) moves this panel's worst-case composited
 * colour (over an adversarial pure-white/pure-black backdrop) closer to a
 * flat mid-grey, dropping the footer's `/70` caption below 4.5:1 at the
 * original 78% (measured 4.21:1 dark / 4.50:1 light). Bumping to 85%
 * restores it (5.17:1 dark / 4.92:1 light) — see that file's comment for
 * the full numbers; this panel shares the exact same `--color-base-100`
 * token and alpha, so the same fix at the same value applies unchanged.
 *
 * `:global(...)` wraps the WHOLE selector, not just `[data-soft='true']`
 * — see `SettingsModal.vue`'s identical rule for why: unscoping only the
 * ancestor half and leaving `.about-panel`/`.settings-panel` to pick up
 * the usual `[data-v-hash]` silently compiles away the class part of the
 * selector entirely in this Vue/Vite version (confirmed against this
 * project's actual compiled output), leaving a bare `[data-soft='true']`
 * rule that matches `<html>` instead of the panel. Fully unscoping loses
 * the `[data-v-hash]` specificity boost, tying (not beating) the base
 * rule's specificity, but this rule is still textually later in the same
 * compiled output, so it wins on source order at that tie.
 *
 * Guarded by the same `no-preference` media query for the same reason as
 * `SettingsModal.vue`'s rule: without it, this rule would apply
 * unconditionally and, tied-but-later, would wrongly win over the
 * `reduce` rule above for a reduced-transparency user too, reintroducing
 * translucency where that rule explicitly wants none. */
@media (prefers-reduced-transparency: no-preference) {
  :global([data-soft='true'] .about-panel) {
    background-color: color-mix(in srgb, var(--color-base-100) 85%, transparent);
  }
}
</style>

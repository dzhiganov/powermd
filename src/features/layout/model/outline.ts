import { createEffect, createEvent, createStore, sample } from 'effector'

import { readStorage, writeStorage } from '@/shared/lib/storage'
import { $html } from '@/features/preview'

// New in the Phase 2 visual redesign — the reference design's header has an
// "Outline" toggle with no equivalent in this app before now. Lives in
// `layout` (not a new dedicated feature) since it's a thin derivation off
// the preview's own `$html` plus one boolean UI-open store, rendered
// entirely inside this feature's own `PreviewPane.vue` — not enough surface
// area to justify a whole new feature folder, and `layout` already imports
// `preview`'s public API elsewhere (`PreviewPane.vue`'s `<Preview>`).

const OUTLINE_OPEN_KEY = 'markdown-editor:outline-open'

function readBoolean(key: string, fallback: boolean): boolean {
  const stored = readStorage(key)
  if (stored === null) return fallback
  return stored === 'true'
}

export const outlineToggled = createEvent()
// Defaults open, matching the reference design's default state.
export const $outlineOpen = createStore<boolean>(readBoolean(OUTLINE_OPEN_KEY, true)).on(
  outlineToggled,
  (open) => !open,
)

const persistFx = createEffect((open: boolean) => {
  writeStorage(OUTLINE_OPEN_KEY, String(open))
})

sample({ clock: $outlineOpen, target: persistFx })

export interface OutlineHeading {
  level: 1 | 2 | 3
  text: string
  /** The heading's `data-line` (see `preview/lib/rehypeDataLine.ts`) — the
   * exact same anchor `scroll-sync`'s anchor table keys off. Used as this
   * list's identity instead of `text`: duplicate heading text ("Notes",
   * "Notes", …) is common in real documents, and `text` is not unique,
   * while `data-line` is guaranteed unique and line-ascending for every
   * element the rendered preview actually tags (`rehypeDataLine`'s
   * contract) — safe to use as a Vue `:key` and as the scroll-to/
   * active-heading identity in `PreviewPane.vue`. */
  line: number
}

// h1-h3 only, tagged with `data-line` by `rehypeDataLine` — same depth the
// reference design's outline nav shows, and deep enough to stay a
// scannable "on this page" list rather than a full document map. Matches
// against the *rendered* HTML (see `extractHeadings` below), so a raw
// `<h2 data-foo>` typed straight into the source is picked up exactly like
// a `##` heading — both go through the same pipeline and come out tagged
// the same way.
const HEADING_PATTERN = /<h([1-3])\b[^>]*\bdata-line="(\d+)"[^>]*>([\s\S]*?)<\/h\1>/g

/** Turns a heading's inner HTML (already sanitized — this only ever runs
 * on `$html`, which has already been through `rehype-sanitize`) into plain
 * text, the same way `Node.textContent` would: strips tags (`**bold**` ->
 * `bold`, a nested `<code>` -> its text, etc.) and decodes entities in one
 * pass. Only ever parses the small heading snippet, not the whole
 * document, so this stays cheap even called once per heading. */
function extractText(innerHtml: string): string {
  const doc = new DOMParser().parseFromString(`<div>${innerHtml}</div>`, 'text/html')
  return (doc.body.firstElementChild?.textContent ?? '').trim()
}

/**
 * Parses headings out of the already-rendered, already-debounced `$html`
 * (see `preview/model/preview.ts`) rather than scanning the raw markdown
 * source on every keystroke, for two reasons:
 *
 * 1. Debounce/off-main-thread rendering for free. `$html` only updates
 *    150ms after typing pauses (and the render itself runs in a worker),
 *    so this derivation — however cheap on its own — only ever re-runs on
 *    that same cadence, never once per keystroke.
 * 2. A single anchoring mechanism. The `data-line` read here is the exact
 *    same attribute `scroll-sync`'s anchor table (`buildAnchorTable`) is
 *    built from, so a click on a heading in `PreviewPane.vue` and the
 *    "currently in view" highlight both key off the one anchor the app
 *    already has — not a second, independent line-counting scheme (the
 *    markdown-source regex this replaced) that could drift from the
 *    rendered DOM the moment raw HTML, an autolink, or a GFM footnote
 *    shifts a heading's true line.
 *
 * A heading with no visible text (e.g. `# ![img](...)` with no alt text)
 * is dropped — nothing useful to show or navigate to in the outline list.
 */
function extractHeadings(html: string): OutlineHeading[] {
  const headings: OutlineHeading[] = []
  for (const match of html.matchAll(HEADING_PATTERN)) {
    const text = extractText(match[3])
    if (text === '') continue
    headings.push({ level: Number(match[1]) as 1 | 2 | 3, text, line: Number(match[2]) })
  }
  return headings
}

export const $outlineHeadings = $html.map(extractHeadings)

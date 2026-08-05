import { createEffect, createEvent, createStore, sample } from 'effector'

import { readStorage, writeStorage } from '@/shared/lib/storage'
import { $content } from '@/features/editor'

// New in the Phase 2 visual redesign — the reference design's header has an
// "Outline" toggle with no equivalent in this app before now. Lives in
// `layout` (not a new dedicated feature) since it's a thin derivation off
// the editor's own `$content` plus one boolean UI-open store, rendered
// entirely inside this feature's own `PreviewPane.vue` — not enough surface
// area to justify a whole new feature folder, and `layout` already imports
// `editor`'s public API elsewhere (`EditorPane.vue`).

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
}

const HEADING_PATTERN = /^(#{1,3})\s+(.*)/

/** Only H1-H3 — same depth the reference design's outline nav shows, and
 * deep enough to stay a scannable "on this page" list rather than a full
 * document map. A heading line inside a fenced code block is picked up as
 * a false positive by this regex-over-lines approach (it has no notion of
 * fence state) — an accepted trade-off for staying a plain derivation of
 * the raw markdown source with no separate parse pass, same spirit as the
 * reference design's own naive `text.split('\n')` heading scan. */
function extractHeadings(source: string): OutlineHeading[] {
  const headings: OutlineHeading[] = []
  for (const line of source.split('\n')) {
    const match = HEADING_PATTERN.exec(line)
    if (match) {
      headings.push({ level: match[1].length as 1 | 2 | 3, text: match[2].trim() })
    }
  }
  return headings
}

export const $outlineHeadings = $content.map(extractHeadings)

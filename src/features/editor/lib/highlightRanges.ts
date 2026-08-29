import type { ChangeDesc } from '@codemirror/state'

/** The minimal shape this module maps. Deliberately narrower than
 * `documents`' own `Highlight` — re-anchoring needs an identity and a span
 * and nothing else, so the editor never has to know a highlight has a
 * colour, a note, or a document it belongs to. */
export interface AnchoredRange {
  id: string
  from: number
  to: number
}

export interface RemapResult {
  /** Ranges that survived, with updated offsets. Only those that actually
   * MOVED are included — see `remapRanges`' doc comment. */
  moved: AnchoredRange[]
  /** Ids whose text was deleted outright. */
  removed: string[]
}

/**
 * Re-anchors highlight ranges across a document change.
 *
 * ASSOCIATION. Both ends lean INWARD — `from` maps with assoc `+1`, `to`
 * with `-1` — so text typed at either boundary stays OUTSIDE the highlight,
 * and only text typed strictly inside is absorbed. The rule is "a highlight
 * covers the text you highlighted", which is the one users can predict
 * without being told.
 *
 * Leaning outward was tried first, on the reasoning that typing at an edge
 * means "I'm still writing this bit". It is wrong at the leading edge, and
 * an end-to-end test caught it: with a highlight at the very start of the
 * document, typing a new opening sentence in front of it silently swallowed
 * that sentence into the highlight. Prefixing text is not continuing the
 * highlighted thought, and there is no way to type before a highlight that
 * starts at offset 0 if its leading edge is sticky.
 *
 * DELETION. A highlight whose text is entirely gone is REMOVED, not
 * collapsed to a zero-width marker. This is the deliberate difference from
 * the parked bookmarks feature, whose gutter dots used
 * `MapMode.TrackBefore` to survive any deletion: a bookmark marks a PLACE,
 * so it still means something once the line it sat on is gone, but a
 * highlight is a span OF TEXT — with the text deleted there is nothing left
 * to colour, and keeping it would leave an invisible, unclickable row in the
 * panel that the user has no way to get rid of except by finding it in a
 * list of identical empty rows.
 *
 * "Entirely gone" is decided by measuring how much of the original span
 * survived (`survivingLength` below), NOT by looking at where the endpoints
 * mapped to. When a change REPLACES a span, `mapPos` moves the deleted
 * endpoints onto the replacement's edges — so with `from` leaning left and
 * `to` leaning right, a highlight inside the replaced text comes back out as
 * a perfectly valid range wrapped around text nobody highlighted. Select a
 * whole document, type one character, and every highlight in it would
 * reattach itself to that character, all of them identical and all of them
 * wrong. (`ChangeDesc.touchesRange` looks like the obvious guard here and is
 * not: it reports plain `true` for the replace-everything case, not the
 * `'cover'` its name suggests — measured, not assumed.)
 *
 * ONLY MOVED RANGES ARE RETURNED. Every keystroke maps every range, but a
 * keystroke near the end of a long document moves none of the ones above it.
 * Returning the whole set would mean rewriting every highlight in IndexedDB
 * on every keystroke; returning the difference means a document with fifty
 * highlights writes nothing at all while you type above them.
 */
export function remapRanges(ranges: readonly AnchoredRange[], changes: ChangeDesc): RemapResult {
  const moved: AnchoredRange[] = []
  const removed: string[] = []

  for (const range of ranges) {
    if (survivingLength(range, changes) === 0) {
      removed.push(range.id)
      continue
    }

    const from = changes.mapPos(range.from, 1)
    const to = changes.mapPos(range.to, -1)

    // Belt and braces: a range that still collapsed has no text to colour.
    if (to <= from) {
      removed.push(range.id)
      continue
    }
    if (from !== range.from || to !== range.to) {
      moved.push({ id: range.id, from, to })
    }
  }

  return { moved, removed }
}

/** How many characters of `range`'s ORIGINAL text the change left behind.
 *
 * `iterChangedRanges` reports each change as a span in the OLD document
 * (`fromA`..`toA`) — exactly the coordinate space the range is still in at
 * this point — so subtracting the overlaps gives the surviving length
 * directly, with no dependence on how the endpoints happen to map. Zero
 * means every highlighted character was deleted or typed over. */
function survivingLength(range: AnchoredRange, changes: ChangeDesc): number {
  let deleted = 0
  changes.iterChangedRanges((fromA, toA) => {
    const start = Math.max(fromA, range.from)
    const end = Math.min(toA, range.to)
    if (end > start) deleted += end - start
  })
  return range.to - range.from - deleted
}

/**
 * Whether a new highlight over `[from, to)` would be worth creating.
 *
 * A selection collapses to nothing surprisingly often — a stray click, a
 * double-click that lands between words, a drag that ends where it started —
 * and every one of those would otherwise add an invisible entry to the
 * panel. Whitespace-only selections are rejected for the same reason: the
 * highlight would be real but would look like a blank row.
 */
export function isHighlightableRange(from: number, to: number, text: string): boolean {
  return to > from && text.trim() !== ''
}

/**
 * Finds the highlight at `pos`, preferring the one that starts latest.
 *
 * Highlights are allowed to overlap (you can colour a phrase inside an
 * already-highlighted sentence), so a position can belong to several. The
 * innermost — latest-starting — is the one a click should select, matching
 * how clicking nested things works everywhere else: the most specific thing
 * under the cursor wins, otherwise an inner highlight could never be
 * selected at all.
 */
export function highlightAt<T extends AnchoredRange>(ranges: readonly T[], pos: number): T | null {
  let best: T | null = null
  for (const range of ranges) {
    if (pos < range.from || pos > range.to) continue
    if (best === null || range.from > best.from) best = range
  }
  return best
}

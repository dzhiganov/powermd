/**
 * The four highlight colours.
 *
 * Each is a HUE, not a finished colour. The surface a highlight actually
 * paints is that hue mixed a short way into `--color-base-100` (see
 * `--md-hl-*` in `app/styles/main.css`), which is what lets one palette
 * serve both themes: mixing 22% of a mid-tone hue into a near-white surface
 * gives a pale tint, and into a near-black one gives a deep tint, and in
 * both cases the result stays within 22% of the surface the body text was
 * already proven readable against. A fixed pair of hex values per colour
 * would have needed its own contrast measurement per theme AND per soft-
 * contrast setting — four measurements each, twenty-four in total — and
 * would drift the moment a surface token changed.
 *
 * The hues themselves are muted rather than saturated (the highlighter-pen
 * yellows and greens most editors use). A highlight sits under running prose
 * that has to stay comfortable to read for as long as the document is open,
 * not under a single word being flagged for a moment.
 */
export type HighlightColorId = 'amber' | 'green' | 'blue' | 'rose'

export interface HighlightColorOption {
  id: HighlightColorId
  /** Accessible name — used on the swatch buttons and in the highlight
   * cards' own `aria-label`s ("Amber highlight: If a sentence can…"). */
  label: string
}

export const HIGHLIGHT_COLORS: readonly HighlightColorOption[] = [
  { id: 'amber', label: 'Amber' },
  { id: 'green', label: 'Green' },
  { id: 'blue', label: 'Blue' },
  { id: 'rose', label: 'Rose' },
]

export const DEFAULT_HIGHLIGHT_COLOR: HighlightColorId = 'amber'

const IDS = new Set<string>(HIGHLIGHT_COLORS.map((color) => color.id))

/** Guards persisted records: a colour written by a future version (or a
 * corrupted one) falls back rather than rendering as an unstyled span. */
export function isHighlightColorId(value: unknown): value is HighlightColorId {
  return typeof value === 'string' && IDS.has(value)
}

/** The CSS custom property holding this colour's resolved surface. Defined
 * per theme in `app/styles/main.css`; kept as a function here so nothing
 * hand-writes the `--md-hl-` prefix and drifts. */
export function highlightSurfaceVar(color: HighlightColorId): string {
  return `var(--md-hl-${color})`
}

/** The stronger, more saturated form of the same hue — the panel card's
 * left accent bar and the selected state of a swatch. Deliberately not the
 * surface colour: a 22% tint is almost invisible as a 3px bar. */
export function highlightAccentVar(color: HighlightColorId): string {
  return `var(--md-hl-${color}-accent)`
}

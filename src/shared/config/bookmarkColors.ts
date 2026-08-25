/**
 * The bookmarks feature's fixed colour palette — six hues, each a single
 * hex value shared by every theme x soft-contrast combination (unlike
 * `--md-accent`/`--color-primary` in `app/styles/main.css`, which need a
 * *different* hex per theme to clear contrast in both directions). A single
 * hex works here because each of these six was chosen to sit in the
 * "middle luminance band" that clears the WCAG 3:1 non-text floor against
 * BOTH a near-white surface (light theme) and a near-black one (dark
 * theme) at once — see this module's own measured accounting below rather
 * than trusting the derivation blind.
 *
 * MEASURED — relative-luminance WCAG contrast (the same formula
 * `shared/lib/focusDimColor.test.ts` re-derives by hand), against the two
 * surfaces a bookmark colour actually renders on (`--color-base-100`, the
 * editor gutter's own background per `editor/lib/theme.ts`'s `daisyEditorTheme`,
 * and `--md-pop`, the bookmarks popover's background per `PopoverMenu.vue`),
 * in all four theme x soft-contrast combinations (hexes copied from
 * `app/styles/main.css`):
 *
 *   light off   --color-base-100 #fbfaf8 / --md-pop #ffffff
 *   light on    --color-base-100 #e9e7e2 / --md-pop #f2f0ec   (tightest: darker canvas)
 *   dark  off   --color-base-100 #0e0f11 / --md-pop #15171a   (tightest: darker canvas)
 *   dark  on    --color-base-100 #1b1c1e / --md-pop #222326
 *
 * Every colour below clears 3:1 against all eight (surface x combination)
 * pairings, worst case included:
 *
 *   red    #c2504a  worst 3.74:1 (light on, base-100)
 *   amber  #b3651b  worst 3.54:1 (light on, base-100)
 *   green  #3f7d4b  worst 3.18:1 (dark on, md-pop)
 *   blue   #4580b5  worst 3.39:1 (light on, base-100)
 *   purple #8f63ab  worst 3.40:1 (dark on, md-pop)
 *   teal   #2f7f7f  worst 3.34:1 (dark on, md-pop)
 *
 * Re-verify with `node` + the WCAG formula (`(lighter+0.05)/(darker+0.05)`)
 * before changing any of these hexes — the margin above 3:1 is real but not
 * huge (as little as ~0.18:1 for green/teal against dark-mode `--md-pop`),
 * so a "small" hue tweak can cross the floor.
 */
export type BookmarkColorId = 'red' | 'amber' | 'green' | 'blue' | 'purple' | 'teal'

export interface BookmarkColorOption {
  id: BookmarkColorId
  /** Accessible label, used in the colour picker's radio group and in
   * generated `aria-label`s (e.g. "Bookmark, Amber, line 12"). */
  label: string
  hex: string
}

export const BOOKMARK_COLORS: readonly BookmarkColorOption[] = [
  { id: 'red', label: 'Red', hex: '#c2504a' },
  { id: 'amber', label: 'Amber', hex: '#b3651b' },
  { id: 'green', label: 'Green', hex: '#3f7d4b' },
  { id: 'blue', label: 'Blue', hex: '#4580b5' },
  { id: 'purple', label: 'Purple', hex: '#8f63ab' },
  { id: 'teal', label: 'Teal', hex: '#2f7f7f' },
]

export const DEFAULT_BOOKMARK_COLOR: BookmarkColorId = 'red'

const BOOKMARK_COLOR_IDS: readonly string[] = BOOKMARK_COLORS.map((option) => option.id)

/** Defensive membership check — the one place `documents/lib/db.ts`'s
 * `normalizeBookmark` and any other reader defers to, so "is this a known
 * colour id" is never reimplemented ad hoc. */
export function isBookmarkColorId(value: unknown): value is BookmarkColorId {
  return typeof value === 'string' && BOOKMARK_COLOR_IDS.includes(value)
}

/** Hex for a given colour id, falling back to the default colour's hex for
 * anything unrecognised (a malformed/future-shaped stored value) — never
 * throws, matching `lib/db.ts`'s "drop/repair, never throw" normalization
 * philosophy elsewhere in this app. */
export function bookmarkColorHex(id: string): string {
  return BOOKMARK_COLORS.find((option) => option.id === id)?.hex ?? BOOKMARK_COLORS[0].hex
}

export function bookmarkColorLabel(id: string): string {
  return BOOKMARK_COLORS.find((option) => option.id === id)?.label ?? BOOKMARK_COLORS[0].label
}

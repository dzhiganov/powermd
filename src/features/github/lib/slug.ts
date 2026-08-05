/**
 * Turns a document title into a usable GitHub path segment — lowercase
 * ASCII, hyphen-separated, safe to embed directly as a filename with no
 * further encoding. Used only to seed "Save to GitHub"'s path field with a
 * sensible default (see `model/save.ts`); the user can freely edit it
 * afterwards, so this never needs to be reversible or unique, just
 * plausible.
 *
 * Accented Latin characters are folded to their base letter first (NFKD
 * decomposition + stripping the resulting combining marks — "café" ->
 * "cafe"). Anything left that isn't printable ASCII — CJK, emoji, most
 * other scripts — has no ASCII folding and is dropped entirely, which is
 * why a title that's *entirely* such characters still needs a non-empty
 * fallback: `'document'`. Without it, a CJK-only or emoji-only title would
 * seed an empty (or `.md`-only) path, which `lib/path.ts`'s validator would
 * then have to reject right back at the user with no clue why.
 */

// Nonspacing combining marks (Unicode general category Mn) — what NFKD
// decomposition leaves behind once an accented letter is split into base +
// mark. A Unicode property escape, rather than a literal codepoint-range
// character class, so the source file has no raw combining-mark characters
// in it (those render unreadably in most editors/terminals/diffs).
const COMBINING_MARKS = /\p{Mn}/gu

// Printable ASCII only (space through tilde) — everything NFKD couldn't
// fold into that range (CJK, emoji, most non-Latin scripts) is dropped.
const NON_ASCII = /[^\x20-\x7e]/g

const NON_SLUG_CHARS = /[^a-z0-9]+/g
const LEADING_TRAILING_HYPHENS = /^-+|-+$/g

const MAX_SLUG_LENGTH = 80

export function slugify(title: string): string {
  const folded = title.normalize('NFKD').replace(COMBINING_MARKS, '')
  const asciiOnly = folded.replace(NON_ASCII, ' ')
  const slug = asciiOnly
    .toLowerCase()
    .trim()
    .replace(NON_SLUG_CHARS, '-')
    .replace(LEADING_TRAILING_HYPHENS, '')
    .slice(0, MAX_SLUG_LENGTH)
  return slug === '' ? 'document' : slug
}

import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from '@codemirror/autocomplete'

import { WIKI_LINK_TRIGGER, isInsideCode } from './wikiLinkCompletion'

/**
 * In-document word completion: as the user types a word, suggest words that
 * already appear elsewhere in the CURRENT document — no dictionary, no
 * other documents. Deliberately the narrowest possible scope: unlike
 * `wikiLinkCompletion.ts` (which reaches across every open document via an
 * injected mirror store, see that module's doc comment), everything this
 * feature needs — the document's own text — is already sitting on
 * `context.state.doc`, so this module needs no getters, no mirror store, no
 * `src/app/wiring.ts` entry for its DATA (the on/off *setting* is a
 * different story — see `useCodeMirror.ts`'s `setWordCompletion` and
 * `model/editorEvents.ts`'s `$wordCompletionEnabled`).
 *
 * Same "pure core, CodeMirror-facing shell" split as `wikiLinkCompletion.ts`:
 * `extractWords`/`filterWordCompletions` below are plain functions over
 * plain data, unit-testable without a real `EditorView`; `buildWordCompletionSource`
 * is the thin adapter that wires them into `@codemirror/autocomplete`.
 *
 * DESIGN DECISIONS (see the task write-up for the full reasoning; summarised
 * at each relevant point below):
 *  - Minimum prefix: `WORD_COMPLETION_MIN_PREFIX` (3 characters).
 *  - A "word": `WORD_PATTERN` below — letters/digits, plus interior
 *    hyphens/apostrophes, never leading/trailing ones.
 *  - Matching is case-insensitive; the ORIGINAL casing of whichever
 *    occurrence is suggested is preserved (see `filterWordCompletions`).
 *  - The word currently being typed never suggests itself — its specific
 *    occurrence (identified by its start offset) is excluded, not every
 *    occurrence of that text (see `filterWordCompletions`'s `excludeFrom`).
 *  - Ordering: frequency in the document, then proximity to the cursor,
 *    then alphabetical — see `filterWordCompletions`'s doc comment.
 *  - Never triggers inside a fenced/indented code block or inline code,
 *    reusing `wikiLinkCompletion.ts`'s own `isInsideCode` — deliberately
 *    symmetric with that module rather than a special case: code identifiers
 *    are their own (often language-specific, often abbreviated) vocabulary,
 *    prose words from the rest of the document are rarely useful completions
 *    for them, and the reverse (a code token like `useEffect` popping up
 *    while writing a sentence) is exactly the kind of noise a WORD list
 *    (unlike a curated wiki-link title list) is most at risk of producing
 *    since it indexes literally everything, unfiltered by meaning.
 */

/**
 * Three characters. One or two means the menu opens on almost every word
 * typed in ordinary prose (a huge fraction of English words are <=2 letters
 * into a common longer word — "th", "an", "of", "to" all prefix multiple
 * longer words) — a menu that appears on nearly every keystroke is worse
 * than no menu at all for someone writing continuous text. Three is the
 * point where a typed prefix has usually narrowed to a handful of real
 * candidates rather than dozens, without making the user type most of a
 * short word before getting any help typing a long one.
 */
export const WORD_COMPLETION_MIN_PREFIX = 3

export interface WordOccurrence {
  readonly word: string
  readonly from: number
  readonly to: number
}

/**
 * A word is a run of letters/digits that may contain (but never starts or
 * ends with) a hyphen or apostrophe — covers hyphenated compounds
 * ("state-of-the-art") and contractions/possessives ("don't", "team's")
 * while keeping markdown's own use of bare `-`/`'` (list bullets, smart
 * quotes) from ever being extracted as a "word" on its own, and keeping a
 * trailing hyphen at a line-wrap or a trailing apostrophe from a closing
 * quote out of the extracted text (`(?:[\p{L}\p{N}'-]*[\p{L}\p{N}])?`
 * requires the LAST character of a multi-character match to be a letter or
 * digit, same as the first). `\p{L}`/`\p{N}` (Unicode property escapes,
 * hence the `u` flag) rather than `[a-zA-Z0-9]` so this isn't
 * English/ASCII-only — a document written in Cyrillic, French with accents,
 * or CJK gets the same treatment.
 */
const WORD_PATTERN = /[\p{L}\p{N}](?:[\p{L}\p{N}'-]*[\p{L}\p{N}])?/gu

/**
 * Pure extraction: every word-shaped run in `text`, in document order, with
 * its own `[from, to)` offsets. No code-block awareness here — that needs
 * `@codemirror/language`'s syntax tree, which only exists against a real
 * `EditorState`/`CompletionContext` (see `buildWordCompletionSource`'s own
 * exclusion via `isInsideCode`), not against a bare string. A document with
 * no words at all (`''`, or one that's all punctuation/whitespace) returns
 * an empty array; a document that's a single word returns a single entry.
 */
export function extractWords(text: string): WordOccurrence[] {
  const occurrences: WordOccurrence[] = []
  for (const match of text.matchAll(WORD_PATTERN)) {
    const word = match[0]
    const from = match.index
    occurrences.push({ word, from, to: from + word.length })
  }
  return occurrences
}

/**
 * The trigger pattern used with `CompletionContext.matchBefore` to capture
 * the word currently being typed. Deliberately MORE permissive than
 * `WORD_PATTERN` above (no "must end in a letter/digit" requirement): this
 * one runs mid-keystroke, so the text immediately before the cursor might
 * currently end in a bare trailing hyphen/apostrophe the user hasn't
 * finished yet (e.g. `co-` while typing `co-op`) — rejecting that would
 * make the trigger flicker closed and reopen as they keep typing the same
 * word. `WORD_PATTERN`'s stricter boundary only matters for what counts as
 * a *complete, already-written* candidate elsewhere in the document; the
 * in-progress query itself is just "whatever word characters precede the
 * cursor".
 */
export const WORD_TRIGGER = /[\p{L}\p{N}][\p{L}\p{N}'-]*/u

export interface FilterWordCompletionsOptions {
  /** The text typed so far (matched case-insensitively). */
  readonly query: string
  /** The document offset completions are ranked by proximity to. */
  readonly cursorPos: number
  /** The `from` offset of the occurrence currently being typed — excluded
   * from the results by IDENTITY (this specific occurrence), not by text,
   * so another occurrence of the same word elsewhere in the document still
   * offers itself normally (see the module doc comment). */
  readonly excludeFrom: number
}

/**
 * Pure filtering + ranking core. For every occurrence that:
 *  - isn't the one currently being typed (`excludeFrom`),
 *  - case-insensitively starts with `query`,
 *  - and isn't case-insensitively IDENTICAL to `query` (a completion equal
 *    to what's already been typed would insert nothing new — see below),
 *
 * groups by the occurrence's exact (case-sensitive) text — so "JavaScript"
 * and "javascript" are offered as two distinct candidates, same as
 * `wikiLinkCompletion.ts`'s `filterWikiLinkCandidates` treats two
 * differently-cased titles as distinct — and ranks the groups by:
 *
 *  1. Frequency in the document, descending — a word already used several
 *     times is more likely the one being reached for again than a word
 *     used once.
 *  2. Proximity to `cursorPos`, ascending (ties within a frequency band) —
 *     recently-typed context is more likely relevant than something from
 *     far away in a long document, and this is genuinely the tie-break that
 *     matters most in the common case: most words in a real document occur
 *     only once or twice, where frequency alone can't distinguish at all.
 *  3. Alphabetical, ascending — a final deterministic tie-break so the
 *     order is stable and testable rather than dependent on `Map` insertion
 *     order (itself just first-occurrence order, an accident of where the
 *     word happens to sit in the document).
 *
 * The exact-match exclusion (bullet 3 above) is separate from the
 * `excludeFrom` exclusion: consider a document containing "cat" twice, and
 * the user has just finished typing a third "cat" (cursor right after it).
 * `excludeFrom` removes THAT occurrence; the two earlier ones remain and
 * would otherwise be offered as a "completion" whose label is identical to
 * what's already on screen — accepting it would insert zero new characters.
 * Filtering by text equality (not occurrence identity) is what suppresses
 * that no-op regardless of which of the two earlier occurrences it would
 * have come from.
 */
export function filterWordCompletions(
  occurrences: readonly WordOccurrence[],
  options: FilterWordCompletionsOptions,
): string[] {
  const normalizedQuery = options.query.toLowerCase()
  const entries = new Map<string, { count: number; nearest: number }>()

  for (const occurrence of occurrences) {
    if (occurrence.from === options.excludeFrom) continue
    const lower = occurrence.word.toLowerCase()
    if (lower === normalizedQuery) continue
    if (!lower.startsWith(normalizedQuery)) continue

    const distance = Math.abs(occurrence.from - options.cursorPos)
    const existing = entries.get(occurrence.word)
    if (existing) {
      existing.count += 1
      if (distance < existing.nearest) existing.nearest = distance
    } else {
      entries.set(occurrence.word, { count: 1, nearest: distance })
    }
  }

  return Array.from(entries.entries())
    .sort(([wordA, a], [wordB, b]) => {
      if (a.count !== b.count) return b.count - a.count
      if (a.nearest !== b.nearest) return a.nearest - b.nearest
      return wordA < wordB ? -1 : wordA > wordB ? 1 : 0
    })
    .map(([word]) => word)
}

interface WordCompletionCache {
  /** The `from` offset of the word-typing session this cache belongs to —
   * stable across keystrokes that only extend/shorten the SAME word (see
   * `buildWordCompletionSource`'s doc comment). */
  from: number
  /** Document length with the in-progress word's own current length
   * subtracted out — i.e. the length of "everything except the word being
   * typed". Compared against the same computation on every later call as a
   * cheap (if imperfect — see the doc comment below) guard against reusing
   * a cache built for an unrelated earlier session that happened to start
   * at the same offset. */
  backgroundLength: number
  occurrences: WordOccurrence[]
}

/**
 * Builds the `@codemirror/autocomplete` source.
 *
 * PERFORMANCE: `extractWords` is an O(document length) regex scan — cheap
 * for one call, but this source is invoked on every keystroke while the
 * trigger matches (same as `wikiLinkCompletion.ts`'s source — see below for
 * why this one doesn't reach for `validFor` instead), so running it from
 * scratch on every keystroke would mean an O(document length) scan per
 * character typed. The closure-local `cache` above avoids that: while the
 * user keeps extending or shortening the SAME word, `matchBefore`'s `from`
 * (the start of that contiguous run of word characters) doesn't move, so
 * `extractWords` only runs again when `from` changes — i.e. once per NEW
 * word, not once per keystroke. What runs on every keystroke instead is
 * `filterWordCompletions` over the already-extracted occurrence list — a
 * pass over "how many words are in the document" (a Map insert/sort), not
 * "how many characters are in the document", and measured accordingly (see
 * the task report for numbers on a 5k+ word document).
 *
 * The `backgroundLength` check on top of `from` guards against a narrow but
 * real edge case: `from` alone can't distinguish "still typing the same
 * word" from "started an unrelated word that happens to begin at the same
 * offset a *previous, already-finished* word once did" (possible if the
 * document was edited elsewhere in between the two sessions, shifting
 * everything after some point). Comparing "document length minus the
 * in-progress word's own length" catches any edit that changed the
 * document's overall size in between; it does NOT catch a same-length
 * edit elsewhere (e.g. a find-and-replace of one word for another the same
 * length) landing on a coincidentally identical `from` — an accepted,
 * deliberately-not-solved residual case: the practical effect if it ever
 * happens is a suggestion list that's one edit stale, never a wrong
 * insertion or a crash, and it requires two independent coincidences
 * (exact same start offset AND exact same background length) to occur at
 * all.
 *
 * No `validFor` on the returned result — deliberately the same choice
 * `wikiLinkCompletion.ts` makes, for a related but distinct reason: this
 * source already does its own real filtering (`filterWordCompletions`) on
 * every call rather than delegating to `@codemirror/autocomplete`'s default
 * client-side re-filter, so the query/casing handling stays entirely under
 * this module's own control (case-insensitive prefix matching against
 * whatever original casing the document has) instead of depending on the
 * library's own default matcher's case behaviour. The `cache` above is what
 * keeps that "real filtering on every call" from being expensive.
 *
 * `filter: false` + `getMatch`: same reasoning as `wikiLinkCompletion.ts`'s
 * source — every returned word is already guaranteed (by
 * `filterWordCompletions`) to start with `query` case-insensitively, so the
 * matched-prefix highlight range is always `[0, query.length]`, and the
 * library's own default re-filter/score (which compares each label against
 * `state.sliceDoc(from, to)` verbatim, case-sensitively) would otherwise
 * reject a candidate like "JavaScript" against a lowercase-typed "java".
 */
export function buildWordCompletionSource(): CompletionSource {
  let cache: WordCompletionCache | null = null

  return (context: CompletionContext): CompletionResult | null => {
    // Wiki-link completion owns `[[...` — see `wikiLinkCompletion.ts`'s own
    // trigger. Checked FIRST and unconditionally: if the cursor is inside an
    // open `[[` span, word completion must stay silent regardless of
    // whether `WORD_TRIGGER` would also match the same text (it would —
    // "wid" inside "[[wid" is a perfectly valid word-trigger match too), so
    // the two menus can never appear together or fight over which one wins.
    if (context.matchBefore(WIKI_LINK_TRIGGER)) return null

    const match = context.matchBefore(WORD_TRIGGER)
    if (!match) return null
    if (match.text.length < WORD_COMPLETION_MIN_PREFIX) return null
    if (isInsideCode(context)) return null

    const backgroundLength = context.state.doc.length - (match.to - match.from)
    if (!cache || cache.from !== match.from || cache.backgroundLength !== backgroundLength) {
      cache = {
        from: match.from,
        backgroundLength,
        occurrences: extractWords(context.state.doc.toString()),
      }
    }

    const words = filterWordCompletions(cache.occurrences, {
      query: match.text,
      cursorPos: context.pos,
      excludeFrom: match.from,
    })
    if (words.length === 0) return null

    const options: Completion[] = words.map((word) => ({ label: word, type: 'text' }))

    return {
      from: match.from,
      options,
      filter: false,
      getMatch: () => [0, match.text.length],
    }
  }
}

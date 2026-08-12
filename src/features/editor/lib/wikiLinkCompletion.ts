import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import {
  insertCompletionText,
  pickedCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from '@codemirror/autocomplete'

/**
 * Inline `[[Title]]` wiki-link autocomplete — typing `[[` opens a
 * suggestion list of document titles that filters as the user keeps
 * typing, mirroring `remarkWikiLink.ts`'s `[[Title]]` syntax on the
 * editing side. This module owns the CodeMirror-facing half (trigger
 * detection, code-block exclusion, insertion); the candidate title list
 * itself is injected from outside (see `filterWikiLinkCandidates` below)
 * rather than read from a store directly, the same "pure core, live data
 * pushed in" split `lib/search.ts`'s `formatMatchCount` and
 * `features/github/lib/schedule.ts`'s `decideSyncSchedule` already use —
 * it's what makes `filterWikiLinkCandidates` trivially unit-testable
 * without constructing a real `EditorView` or effector store.
 *
 * `editor` never imports `documents` (see `ARCHITECTURE.md`'s feature
 * boundary rules) — the live `{ id, title }` list and the current
 * document's id are supplied at call time via the two getter functions
 * `buildWikiLinkCompletionSource` takes, backed by this feature's own
 * mirror store (`$wikiLinkDocuments`/`editorEvents.ts`), fed from
 * `src/app/wiring.ts`, the one place that knows both features exist —
 * same shape as `$lineWrapEnabled`/`$spellcheckSettings` in that file.
 * Reading the getters at call time (rather than a snapshot captured once
 * when the extension is built) is also what makes a title renamed or a
 * document created while the editor is open show up without a reload:
 * CodeMirror re-invokes this source on every keystroke inside a `[[...`
 * span (see `buildWikiLinkCompletionSource`'s doc comment on omitting
 * `validFor`), and every one of those calls reads the getters fresh.
 */

export interface WikiLinkDocument {
  id: string
  title: string
}

/**
 * Pure filtering core: every document whose title starts with `query`
 * (case-insensitive), excluding `currentDocumentId` (a document linking to
 * itself is noise, never a useful suggestion) and excluding duplicate
 * titles (two documents can legally share a title; the label is all a
 * `[[Title]]` link can address, so offering the same label twice would
 * only be confusing, never actionable). Order-preserving over `documents`
 * — callers that want a particular display order (e.g. most-recently-
 * updated first) pass documents in that order.
 *
 * Deliberately returns plain title strings, not `{id, title}` pairs — the
 * one thing a completion actually needs is the label to insert, and
 * keeping ids out of the return value is what makes the HTML-in-a-title
 * case trivial to assert on: whatever string a title is, it comes back
 * out unchanged, never escaped, stripped, or interpreted. Safety against
 * that string being rendered as markup is CodeMirror's own completion-list
 * renderer's job (`document.createTextNode`, never `innerHTML` — see the
 * task's DOM-inspection evidence), not this function's.
 */
export function filterWikiLinkCandidates(
  documents: readonly WikiLinkDocument[],
  currentDocumentId: string | null,
  query: string,
): string[] {
  const normalizedQuery = query.toLowerCase()
  const seen = new Set<string>()
  const results: string[] = []
  for (const doc of documents) {
    if (doc.id === currentDocumentId) continue
    if (!doc.title.toLowerCase().startsWith(normalizedQuery)) continue
    if (seen.has(doc.title)) continue
    seen.add(doc.title)
    results.push(doc.title)
  }
  return results
}

/**
 * `[[` optionally followed by more title characters, anchored to end
 * exactly at the cursor (`CompletionContext.matchBefore` appends `$`
 * itself — see `@codemirror/autocomplete`'s `ensureAnchor`). Excluding `]`
 * from the character class is what makes this stop matching the instant a
 * `]]` has already been typed (an already-closed link has nothing left to
 * complete), and excluding `[`/`\n` keeps a match from ever spanning a
 * second `[[` or a line break.
 *
 * Exported so `wordCompletion.ts` can test the same pattern against the
 * cursor and bail out when it matches — see that module's own doc comment
 * for why the two sources must never both offer suggestions at once.
 */
export const WIKI_LINK_TRIGGER = /\[\[[^[\]\n]*/

/** Node names `@lezer/markdown` (via `@codemirror/lang-markdown`) gives
 * code content — both flavours of fenced/indented code block and both
 * flavours of inline code carry their literal text in one of these, never
 * in a plain `text`/paragraph node. Checked by walking up from the cursor
 * so a `[[` typed anywhere inside — fence markers included — is covered,
 * not just the innermost text node. Exported for `wordCompletion.ts`, which
 * makes the same deliberate choice to stay out of code (see its own doc
 * comment) and would otherwise need a second copy of this walk. */
export const CODE_NODE_NAMES = new Set(['CodeBlock', 'FencedCode', 'InlineCode', 'CodeText'])

export function isInsideCode(context: CompletionContext): boolean {
  let node: SyntaxNode | null = syntaxTree(context.state).resolveInner(context.pos, -1)
  while (node) {
    if (CODE_NODE_NAMES.has(node.name)) return true
    node = node.parent
  }
  return false
}

/**
 * Builds the `@codemirror/autocomplete` source. `getDocuments`/
 * `getCurrentDocumentId` are called fresh on every invocation (see the
 * file doc comment) rather than closed over once.
 *
 * No `validFor` on the returned result: per `@codemirror/autocomplete`'s
 * own `checkValid` (`if (!validFor) return false`), omitting it means the
 * previous result is never treated as still valid for a later keystroke —
 * this source is re-run on every character typed inside a `[[...` span
 * instead of the library filtering a cached option list client-side. That
 * is exactly what keeps this reflecting the live document list while the
 * menu is open, at the cost of recomputing a cheap linear filter over a
 * small in-memory list on every keystroke — cheap enough that the
 * trade is one-sided here.
 *
 * Deliberately returns an empty `options: []` array (not `null`) when
 * nothing matches (`filterWikiLinkCandidates` came back empty, whether
 * because there are no other documents or none match the typed prefix):
 * `@codemirror/autocomplete` renders no tooltip for a zero-option result,
 * the same "just show nothing" behaviour as returning `null`, but keeps
 * this a single return path instead of two.
 */
export function buildWikiLinkCompletionSource(
  getDocuments: () => readonly WikiLinkDocument[],
  getCurrentDocumentId: () => string | null,
): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(WIKI_LINK_TRIGGER)
    if (!match) return null
    if (isInsideCode(context)) return null

    const query = match.text.slice(2) // drop the leading `[[`
    const titles = filterWikiLinkCandidates(getDocuments(), getCurrentDocumentId(), query)

    const options: Completion[] = titles.map((title) => ({
      label: title,
      type: 'text',
      apply: (view, completion, from, to) => {
        // Inserts the FULL `[[Title]]` marker (not just the bare title —
        // the user is never left to type the closing `]]` themselves) and
        // places the cursor right after it: `insertCompletionText` (the
        // library's own multi-range-safe insertion helper, see its doc
        // comment) puts the cursor at `insert`'s own length past the
        // replaced range, which for `[[Title]]` is exactly "after the
        // closing bracket".
        const insert = `[[${title}]]`
        view.dispatch({
          ...insertCompletionText(view.state, insert, from, to),
          annotations: pickedCompletion.of(completion),
        })
      },
    }))

    // `filter: false` — the label is a bare title ("Bravo Notes"), never
    // starting with the replaced range's own text ("[[Bra"), so
    // `@codemirror/autocomplete`'s default built-in re-filter/score (which
    // matches each label against `state.sliceDoc(from, to)` verbatim) would
    // reject every option outright. `filterWikiLinkCandidates` above is
    // already this source's own case-insensitive prefix filter over the
    // query with the leading `[[` stripped, so the library's redundant pass
    // is simply disabled rather than worked around by renaming the field it
    // compares against.
    //
    // `getMatch` (a field of the *result*, not of each `Completion` — see
    // `@codemirror/autocomplete`'s own `buildOptions`, which reads
    // `a.result.getMatch` once per result rather than per option) is what
    // restores the matched-prefix highlighting `filter: false` otherwise
    // skips entirely: every title `filterWikiLinkCandidates` returns is
    // already guaranteed to start with `query` case-insensitively, so the
    // matched range is always `[0, query.length]` for every option, with no
    // per-completion re-scoring needed.
    return {
      from: match.from,
      options,
      filter: false,
      getMatch: () => (query.length > 0 ? [0, query.length] : []),
    }
  }
}

// The tooltip's own styling (`inlineCompletionTheme`) and the single
// `autocompletion()` extension that registers this source alongside
// `wordCompletion.ts`'s both now live in `useCodeMirror.ts` /
// `completionTheme.ts` — see `useCodeMirror.ts`'s `buildCompletionExtension`
// for why the two sources share one `autocompletion()` instance rather than
// each getting its own.

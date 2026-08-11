import { findAndReplace } from 'mdast-util-find-and-replace'
import type { Plugin } from 'unified'
import type { Data, Node, Root } from 'mdast'

/**
 * `[[Title]]` / `[[Title|alias]]` wiki-link syntax (Obsidian's convention),
 * parsed at the mdast level so it composes with everything else remark
 * already does — emphasis, GFM autolinks, footnotes — rather than being a
 * post-hoc string replacement over already-rendered HTML.
 *
 * What this stage does NOT do: decide whether a title actually resolves to
 * a document. The render worker (`worker.ts`) is a pure, stateless
 * string -> string function with no access to the live document list — see
 * `pipeline.ts`'s top-level doc comment for the full worker/main-thread
 * split this belongs to. So this stage always emits the same neutral
 * marker regardless of whether the title exists: an `<a class="wiki-link"
 * data-wikilink-title="...">` carrying the raw title as data, resolved
 * into `wiki-link--resolved` / `wiki-link--unresolved` afterwards, on the
 * main thread, by `lib/wikiLinkResolver.ts` — the same "worker emits inert
 * markup, main thread finishes the job" shape `mermaidRenderer.ts` already
 * uses, just for app state instead of DOM access.
 */

/** The one class every wiki-link marker carries, regardless of resolution
 * state — `lib/wikiLinkResolver.ts`'s `WIKI_LINK_SELECTOR` finds anchors by
 * this class, and `sanitizeSchema.ts` allow-lists exactly this literal (not
 * a pattern) for `a`'s `className`, so it's exported once here rather than
 * duplicated as a string literal in three files that all have to agree on
 * it. */
export const WIKI_LINK_CLASS = 'wiki-link'

/** mdast node for a parsed `[[Title]]` / `[[Title|alias]]`. Not a `Parent`
 * (no `children`) — same leaf shape as mdast's own `Image`/`Break`: the
 * text actually shown (`alias ?? title`) lives in `data.hChildren` below,
 * built once at parse time, not derived again later. */
export interface WikiLink extends Node {
  type: 'wikiLink'
  /** Trimmed, original-case title as written between the outer `[[` `]]`.
   * Case is deliberately preserved here — resolution's case-insensitive
   * matching is `lib/wikiLinkResolver.ts`'s concern, not the parser's; see
   * that module's `buildTitleResolver`. */
  title: string
  /** Trimmed alias from `[[Title|alias]]`, or `null` for a plain
   * `[[Title]]` (falls back to `title` as the displayed text). */
  alias: string | null
}

// Registers `WikiLink` as real mdast phrasing/root content so it can
// appear in a `PhrasingContent[]` children array (inside a paragraph,
// heading, list item, ...) and so `mdast-util-to-hast`'s `Handlers` type
// (keyed by every registered node's `type`) recognises `'wikiLink'` at
// all — see the doc comment on `PhrasingContentMap` in `@types/mdast` for
// this exact "add custom nodes to both maps" instruction. No custom
// `remark-rehype` handler is registered for it, though: `data.hName`/
// `hProperties`/`hChildren` (set in `toWikiLinkNode` below) are enough on
// their own — `mdast-util-to-hast`'s default handler for an unrecognised
// node type already reads those three fields (see
// `defaultUnknownHandler` in `mdast-util-to-hast/lib/state.js`).
declare module 'mdast' {
  interface PhrasingContentMap {
    wikiLink: WikiLink
  }
  interface RootContentMap {
    wikiLink: WikiLink
  }
}

/** `[[Title]]` or `[[Title|alias]]`. `[^[\]|]+` (no `[`, `]`, or `|`) keeps
 * both groups simple single-line text and, deliberately, is what makes
 * `[[]]` and `[[   ]]` fail to match at all (the `+` requires at least one
 * such character) — an empty or whitespace-only title is left standing as
 * literal text rather than becoming a link nobody could resolve or a
 * document nobody meant to create. Global: `findAndReplace` requires it
 * for repeated matches within one text node. */
const WIKI_LINK_PATTERN = /\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]/g

/** `mdast-util-find-and-replace` calls this as `replace(...match, matchObject)`
 * — `_fullMatch` is `match[0]` (unused, but must be accepted so `rawTitle`/
 * `rawAlias` line up with `match[1]`/`match[2]`, the pattern's two capture
 * groups), and a trailing `RegExpMatchObject` (also unused) always follows. */
function toWikiLinkNode(
  _fullMatch: string,
  rawTitle: string,
  rawAlias: string | undefined,
): WikiLink | false {
  const title = rawTitle.trim()
  if (title === '') return false // acts as "no match" — see WIKI_LINK_PATTERN's comment

  const trimmedAlias = rawAlias?.trim()
  const alias = trimmedAlias !== undefined && trimmedAlias !== '' ? trimmedAlias : null
  const display = alias ?? title

  const data: Data = {
    hName: 'a',
    hProperties: {
      className: [WIKI_LINK_CLASS],
      // Serialized as an HTML attribute by `rehype-stringify` with the
      // same escaping every other attribute value gets — a title
      // containing `"` or `<` cannot break out of the attribute or inject
      // markup, it just becomes an escaped attribute value. See
      // `sanitizeSchema.ts` for why this specific attribute is what makes
      // it survive `rehype-sanitize` at all.
      dataWikilinkTitle: title,
      // Never a real destination (`lib/wikiLinkResolver.ts` never
      // rewrites it) — resolved/unresolved is carried purely by class,
      // and every click is intercepted by `src/app/wikiLinks.ts` rather
      // than followed natively. See that module for why `href="#"` is
      // deliberately left alone rather than pointed at anything.
      href: '#',
    },
    // A plain hast text node, not a raw HTML string — `rehype-stringify`
    // HTML-escapes text-node values the same way it does for every other
    // piece of markdown-derived text, so a title/alias containing `<img
    // onerror=...>` renders as inert, visible text, never a parsed
    // element.
    hChildren: [{ type: 'text', value: display }],
  }

  return { type: 'wikiLink', title, alias, data }
}

/**
 * Runs on `text` mdast nodes only (`mdast-util-find-and-replace`'s own
 * scope — see its readme: "the algorithm searches the tree ... for
 * complete values in Text nodes"), which is what makes requirement #5
 * (code spans and fenced code blocks are never transformed) hold without
 * this plugin doing any code-awareness itself: an `inlineCode` node's
 * content lives in its own `value` string, not in a child `text` node,
 * and a fenced ```code``` block is a leaf `code` node the same way — so
 * `[[Title]]` typed inside either is never visited at all, let alone
 * transformed.
 */
export const remarkWikiLink: Plugin<[], Root> = () => (tree) => {
  findAndReplace(tree, [[WIKI_LINK_PATTERN, toWikiLinkNode]])
}

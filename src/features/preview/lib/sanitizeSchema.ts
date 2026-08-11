import { defaultSchema } from 'rehype-sanitize'
import type { Options } from 'rehype-sanitize'

import { WIKI_LINK_CLASS } from './remarkWikiLink'

/** The shape of one entry in an `Options['attributes']` allow-list array
 * (`hast-util-sanitize`'s `PropertyDefinition`) — derived from `Options`
 * itself rather than imported directly, since `hast-util-sanitize` only
 * exports `Schema`/`defaultSchema`/`sanitize` from its package root (no
 * `PropertyDefinition`), and `rehype-sanitize` re-exports even less (just
 * `Options`, aliased to that same `Schema`). */
type AttributeDefinition = NonNullable<Options['attributes']>[string][number]

/**
 * `defaultSchema.attributes.a` already has a `className` entry (allowing
 * only the literal `'data-footnote-backref'`, for GFM footnotes) —
 * `hast-util-sanitize`'s `findDefinition` looks up a property by name and
 * returns the *first* array entry whose name matches, so a second,
 * separate `['className', WIKI_LINK_CLASS]` entry appended after it would
 * never be reached at all, and every wiki-link marker's `class` would
 * sanitize down to an empty string (caught by this file's own test suite
 * — an anchor rendered with `class=""` instead of `class="wiki-link"`).
 * Extending the existing entry's allow-list in place, instead of adding a
 * second one, is what actually works.
 */
function extendClassNameAllowList(
  definitions: readonly AttributeDefinition[],
  ...extra: string[]
): AttributeDefinition[] {
  return definitions.map((definition) =>
    Array.isArray(definition) && definition[0] === 'className'
      ? [...definition, ...extra]
      : definition,
  )
}

/**
 * Extends GitHub's default sanitize schema (already GFM- and
 * highlight-aware for `code`/`li`/`ul`/`ol` classNames) with the
 * attributes this app's own pipeline stages add: `data-line`
 * (`rehypeDataLine.ts`) and the wiki-link marker's `class`/
 * `data-wikilink-title` (`remarkWikiLink.ts`).
 *
 * `hast-util-sanitize`'s default schema strips every `data-*` attribute
 * on every element — there is no per-tag or wildcard allowance for it out
 * of the box — so without this, `data-line` would silently vanish here
 * and Step 5 (scroll sync) would have nothing to read.
 *
 * This does NOT allow-list `rehype-highlight`'s `hljs`/`language-*`
 * classNames. That's intentional: see pipeline.ts for why (sanitize runs
 * before highlight, so highlight's classes never reach the sanitizer).
 */
export const previewSchema: Options = {
  ...defaultSchema,
  /**
   * `u` is added to GitHub's default tag list for the underline action.
   * Markdown has no underline syntax, so the toolbar and `Mod-u` emit
   * `<u>` — which the default schema strips, silently swallowing the
   * formatting the moment it is applied. (Strikethrough needs nothing here:
   * `~~` goes through remark-gfm, and `del`/`s` are already allowed.)
   *
   * This is the security boundary, so it is worth being exact about what
   * this widens. `u` carries no URL, no script, no event handler and no
   * layout capability — it is a text-decoration element and nothing else.
   * Its attributes are untouched, so the `*` allow-list below still governs
   * what may appear on it, exactly as for every other tag.
   */
  tagNames: [...(defaultSchema.tagNames ?? []), 'u'],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'dataLine'],
    /**
     * `a`'s default allow-list (see `defaultSchema.attributes.a`) already
     * permits `href` — every wiki-link marker's `href` is the fixed,
     * scheme-less string `'#'` (`remarkWikiLink.ts`), so no `protocols`
     * change is needed here. What's added: `WIKI_LINK_CLASS` to the
     * existing `className` allow-list (see `extendClassNameAllowList`
     * above), and `data-wikilink-title`. Scoped to `a` rather than added
     * to the `'*'` allowance above: this attribute/class pair is only
     * ever emitted on `a` (`remarkWikiLink.ts`'s `toWikiLinkNode`), so
     * widening every element for it would be strictly more than this
     * feature needs. The literal `WIKI_LINK_CLASS` only — not a pattern
     * also matching `wiki-link--resolved`/`wiki-link--unresolved` —
     * because those two are added by `lib/wikiLinkResolver.ts` directly
     * on the DOM, after this sanitize step has already run; they never
     * need to survive it.
     */
    a: [
      ...extendClassNameAllowList(defaultSchema.attributes?.a ?? [], WIKI_LINK_CLASS),
      'dataWikilinkTitle',
    ],
  },
}

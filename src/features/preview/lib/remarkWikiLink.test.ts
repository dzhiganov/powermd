import { describe, expect, it } from 'vitest'

import { renderMarkdown } from './pipeline'

/**
 * Exercises `remarkWikiLink.ts` through the full pipeline (`renderMarkdown`,
 * same function `worker.ts` and the main-thread fallback both call — see
 * `pipeline.ts`), not the remark plugin in isolation, specifically so the
 * `rehype-sanitize` step (`sanitizeSchema.ts`) is part of what's under
 * test: an assertion that survives sanitize is an assertion about what the
 * live preview and export actually produce, not just what the mdast/hast
 * transform alone would.
 *
 * Resolved vs unresolved styling is deliberately NOT asserted here — the
 * parser has no opinion on it (see `remarkWikiLink.ts`'s doc comment): every
 * `[[Title]]` produces the same neutral `wiki-link` marker regardless of
 * whether the title resolves to anything. That distinction is
 * `wikiLinkResolver.ts`'s `buildTitleResolver`/`decorateWikiLinks`, covered
 * by its own tests.
 */
describe('remarkWikiLink (via renderMarkdown)', () => {
  it('renders [[Title]] as a wiki-link marker with the title as both text and data attribute', () => {
    const html = renderMarkdown('See [[Project Plan]] for details.')

    expect(html).toContain('class="wiki-link"')
    expect(html).toContain('data-wikilink-title="Project Plan"')
    expect(html).toContain('>Project Plan</a>')
  })

  it('renders [[Title|alias]] showing the alias but keying the marker on the title', () => {
    const html = renderMarkdown('[[Project Plan|the plan]]')

    expect(html).toContain('data-wikilink-title="Project Plan"')
    expect(html).toContain('>the plan</a>')
    expect(html).not.toContain('>Project Plan</a>')
  })

  it('an alias that is only whitespace falls back to the title as displayed text', () => {
    const html = renderMarkdown('[[Project Plan|   ]]')

    expect(html).toContain('data-wikilink-title="Project Plan"')
    expect(html).toContain('>Project Plan</a>')
  })

  it('produces the same neutral marker for a title with no matching document ("unresolved")', () => {
    // The parser has no document list to check against at all — this is
    // exactly the same output shape as the resolvable-title case above,
    // which is itself the point: resolution is a separate, later step.
    const html = renderMarkdown('[[Some Title Nobody Has Written Yet]]')

    expect(html).toContain('class="wiki-link"')
    expect(html).toContain('data-wikilink-title="Some Title Nobody Has Written Yet"')
  })

  it('leaves [[...]] syntax untouched inside an inline code span', () => {
    const html = renderMarkdown('Use `[[Title]]` to link.')

    expect(html).not.toContain('wiki-link')
    expect(html).toContain('<code>[[Title]]</code>')
  })

  it('leaves [[...]] syntax untouched inside a fenced code block', () => {
    const html = renderMarkdown('```\n[[Title]]\n```')

    expect(html).not.toContain('wiki-link')
    expect(html).toContain('[[Title]]')
  })

  it('does not transform an empty [[]]', () => {
    const html = renderMarkdown('[[]]')

    expect(html).not.toContain('wiki-link')
    expect(html).toContain('[[]]')
  })

  it('does not transform a whitespace-only [[   ]]', () => {
    const html = renderMarkdown('[[   ]]')

    expect(html).not.toContain('wiki-link')
  })

  it('an [[<img onerror=...>]] title is inert — never executable, whether or not it parses as a wiki-link', () => {
    // `<img ...>` is a syntactically valid inline-HTML tag under
    // CommonMark, so `remark-parse` itself (not this plugin) splits the
    // text into `text("[["), html("<img ... >"), text("]]")` *before*
    // `remarkWikiLink` ever runs — `mdast-util-find-and-replace` only
    // scans `text` nodes (see `remarkWikiLink.ts`'s own doc comment), so
    // there is no single, complete `text` node for its regex to match
    // here, and this never becomes a `wikiLink` node at all. That's fine:
    // the raw `<img>` tag still goes through this same pipeline's
    // existing raw-HTML handling (`allowDangerousHtml` + `rehype-raw` +
    // `rehype-sanitize`, see `pipeline.ts`'s own doc comment on why
    // that's already safe for any raw HTML typed anywhere in a document,
    // wiki-link or not) — so what actually has to hold is just: no
    // executable attribute survives.
    const html = renderMarkdown('[[<img src=x onerror=alert(1)>]]')

    expect(html).not.toContain('onerror')
  })

  it('escapes HTML-significant characters in a title that DOES parse as a wiki-link', () => {
    // No `<`/`>` here, so nothing for `remark-parse`'s inline-HTML
    // tokenizer to intercept (see the test above) — the whole string
    // reaches `remarkWikiLink` as one `text` node and becomes a real
    // `wikiLink` marker, exercising this plugin's own node-based
    // construction (`hProperties`/`hChildren` in `toWikiLinkNode` — never
    // string-concatenated into HTML) against a classic attribute-breakout
    // attempt.
    const html = renderMarkdown('[[Title" onmouseover=alert(1)]]')

    expect(html).toContain('class="wiki-link"')
    // The quote is escaped as part of the (one, whole) attribute value,
    // not left to terminate it early — if it weren't, this exact string
    // wouldn't be a single `data-wikilink-title="..."` attribute value at
    // all, but `onmouseover` breaking out as its own, separate, real HTML
    // attribute the browser would parse and execute.
    expect(html).toContain('data-wikilink-title="Title&#x22; onmouseover=alert(1)"')
  })

  it('preserves the exact case of the title, for two links differing only by case', () => {
    const html = renderMarkdown('[[Foo Bar]] and [[foo bar]]')

    expect(html).toContain('data-wikilink-title="Foo Bar"')
    expect(html).toContain('data-wikilink-title="foo bar"')
  })

  it('supports multiple wiki-links in the same document', () => {
    const html = renderMarkdown('[[One]] and [[Two|second]] and [[Three]].')

    expect(html).toContain('data-wikilink-title="One"')
    expect(html).toContain('data-wikilink-title="Two"')
    expect(html).toContain('>second</a>')
    expect(html).toContain('data-wikilink-title="Three"')
  })
})

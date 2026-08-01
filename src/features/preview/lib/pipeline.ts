import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import rehypeHighlight from 'rehype-highlight'
import rehypeStringify from 'rehype-stringify'

import { rehypeDataLine } from './rehypeDataLine'
import { rehypeStripStrayWhitespace } from './rehypeStripStrayWhitespace'
import { previewSchema } from './sanitizeSchema'

/**
 * Markdown -> sanitized, highlighted HTML.
 *
 * Stage order, and why it's this order:
 *
 * 1. `remarkParse` + `remarkGfm` — markdown source -> mdast, with GitHub-
 *    flavoured tables, strikethrough, task lists, and autolinks.
 * 2. `remarkRehype({ allowDangerousHtml: true })` — mdast -> hast. Raw HTML
 *    typed directly into the source (e.g. a literal `<script>` tag or a
 *    hand-written `<table>`) becomes a `raw` hast node holding the literal
 *    string verbatim, not yet a parsed element. Rendering raw HTML is a
 *    deliberate feature of this editor (the same way Dillinger's preview
 *    does it), not a hole opened for the sanitizer to demonstrate itself
 *    on: `allowDangerousHtml` only controls whether that string survives
 *    this step at all, and it is safe here specifically because
 *    `rehype-sanitize` always runs later in this same pipeline (step 6),
 *    after the string has been parsed into real elements it can inspect.
 *    Measured cost of turning this on: ~24% slower render.
 * 3. `rehypeRaw` — parses those `raw` string nodes into real hast element
 *    nodes, so a typed-in `<script>` becomes an actual `script` element
 *    the sanitizer can see and remove, rather than an opaque string that
 *    would otherwise get serialized back out untouched.
 * 4. `rehypeStripStrayWhitespace` (ours) — `rehypeRaw`'s parse5 pass
 *    foster-parents whitespace-only text between table rows/cells out to
 *    the document root (per the HTML table-parsing spec); this removes
 *    those stray top-level nodes before anything else walks the tree.
 * 5. `rehypeDataLine` (ours) — tags block-level nodes with `data-line`,
 *    read from the `position` `remark-rehype` copied onto them in step 2.
 *    Must run before sanitize, since sanitize is what decides whether the
 *    attribute survives at all.
 * 6. `rehypeSanitize(previewSchema)` — the security boundary. Runs on the
 *    hast tree, never on the markdown source, and after both
 *    `remark-rehype` and `rehype-raw`, so it sees (and can strip)
 *    anything either produced: `<script>` elements, `on*` event-handler
 *    attributes, `javascript:` URLs, and any tag/attribute outside
 *    GitHub's allow-list.
 * 7. `rehypeHighlight` — deliberately runs AFTER sanitize, not before.
 *    `rehype-highlight` marks up fenced code with `hljs` and
 *    `hljs-<token>` classNames, none of which match the default schema's
 *    `code: [['className', /^language-./]]` allowance (that pattern is
 *    only for the `language-js`-style class `remark-rehype` itself adds
 *    from the fence info string). Running highlight after sanitize means
 *    those classNames are written onto a tree that has already passed
 *    the sanitizer, so they're never at risk of being stripped — without
 *    having to widen the schema to allow-list every highlight.js
 *    classname `lowlight`'s grammars can produce.
 * 8. `rehypeStringify` — hast -> HTML string, fed into `v-html`.
 */
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeStripStrayWhitespace)
  .use(rehypeDataLine)
  .use(rehypeSanitize, previewSchema)
  .use(rehypeHighlight)
  .use(rehypeStringify)

/** Renders markdown source to sanitized, highlighted HTML. Synchronous —
 * every stage in this pipeline is pure tree transformation, no I/O. Can
 * throw (a plugin bug, an unexpected input shape); callers decide how to
 * degrade, this function only does the rendering. */
export function renderMarkdown(source: string): string {
  return String(processor.processSync(source))
}

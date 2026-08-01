import type { Plugin } from 'unified'
import type { Element, Root } from 'hast'

/**
 * Tags block-level nodes in the rendered tree with a `data-line`
 * attribute holding their starting line number in the markdown source,
 * for editor/preview scroll sync (wired up in a later step).
 *
 * `remark-rehype` copies each mdast node's `position` onto the hast node
 * it produces, so `node.position.start.line` is already available here —
 * no need to walk the mdast tree ourselves.
 *
 * Two passes:
 *
 * 1. Strip every pre-existing `data-line`, anywhere in the tree. The
 *    sanitize schema allow-lists `dataLine` on `*` (see sanitizeSchema.ts),
 *    so raw HTML typed into the source — e.g. `<span data-line="9999">` —
 *    can otherwise plant a fake anchor at any depth with an arbitrary
 *    value, which this plugin would then leave standing right next to the
 *    real ones it sets below.
 * 2. Tag the nodes this plugin owns: every top-level block (direct child
 *    of the hast root — paragraphs, headings, lists, tables, code blocks,
 *    etc.), plus block-level descendants that carry their own `position`
 *    so a long list, blockquote, or table doesn't collapse to a single
 *    anchor for the whole block: `li` and `tr` wherever they occur, and
 *    `p` / `blockquote` / `pre` nested inside a `ul` / `ol` / `blockquote`
 *    / `table` ancestor. Nodes without a `position` (e.g. remark-gfm's
 *    generated footnote `<section>` itself) are skipped, not thrown on.
 *
 *    remark-gfm's generated footnotes `<section>` (`mdast-util-to-hast`'s
 *    `footer()`) is skipped as a whole subtree, not just left unpositioned:
 *    it moves each footnote definition's rendered `<li>` to the end of the
 *    document but copies the *definition's original source line* onto
 *    that `<li>` (`state.patch(definition, listItem)`), and its `<ol>`
 *    otherwise qualifies as a `CONTAINER_TAGS` ancestor like any other
 *    list. Left untouched, those `<li>`s would get tagged with line
 *    numbers from earlier in the document, breaking the anchor table's
 *    line-ascending order (`anchorTable.ts` defends against this
 *    independently, but there's no reason to feed it bad input here).
 *
 * This has to run before `rehype-sanitize` (see sanitizeSchema.ts, which
 * allow-lists `dataLine`) and after `rehype-raw` (so the raw HTML this
 * plugin strips fake anchors from has already been parsed into real
 * elements rather than opaque `raw` string nodes).
 */

const CONTAINER_TAGS = new Set(['ul', 'ol', 'blockquote', 'table'])
const NESTED_BLOCK_TAGS = new Set(['p', 'blockquote', 'pre'])

function isGeneratedFootnotesSection(node: Element): boolean {
  return node.tagName === 'section' && node.properties.dataFootnotes !== undefined
}

function stripDataLine(node: Element): void {
  if (node.properties.dataLine !== undefined) {
    delete node.properties.dataLine
  }
  for (const child of node.children) {
    if (child.type === 'element') stripDataLine(child)
  }
}

function tagOwned(node: Element): void {
  const line = node.position?.start.line
  if (line === undefined) return
  node.properties.dataLine = line
}

/**
 * Recurses through `node`'s children, tagging `li`/`tr` unconditionally
 * and `p`/`blockquote`/`pre` only once a `ul`/`ol`/`blockquote`/`table`
 * ancestor has been seen. `hasContainerAncestor` only ever turns on, so
 * it stays correct through intermediate wrapper tags a container
 * introduces (e.g. `thead`/`tbody` between `table` and `tr`).
 */
function tagDescendants(node: Element, hasContainerAncestor: boolean): void {
  for (const child of node.children) {
    if (child.type !== 'element') continue
    if (isGeneratedFootnotesSection(child)) continue

    if (child.tagName === 'li' || child.tagName === 'tr') {
      tagOwned(child)
    } else if (hasContainerAncestor && NESTED_BLOCK_TAGS.has(child.tagName)) {
      tagOwned(child)
    }

    tagDescendants(child, hasContainerAncestor || CONTAINER_TAGS.has(child.tagName))
  }
}

export const rehypeDataLine: Plugin<[], Root> = () => (tree) => {
  for (const child of tree.children) {
    if (child.type === 'element') stripDataLine(child)
  }

  for (const child of tree.children) {
    if (child.type !== 'element') continue
    if (isGeneratedFootnotesSection(child)) continue

    tagOwned(child)
    tagDescendants(child, CONTAINER_TAGS.has(child.tagName))
  }
}

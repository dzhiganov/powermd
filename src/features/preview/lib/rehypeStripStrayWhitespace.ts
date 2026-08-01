import type { Plugin } from 'unified'
import type { Root } from 'hast'

const WHITESPACE_ONLY = /^\s+$/

/**
 * Removes whitespace-only text nodes that are direct children of the hast
 * root.
 *
 * `rehype-raw` re-parses the tree through parse5, which — per the HTML
 * parsing spec's table-in-body handling — foster-parents text that sits
 * between table rows/cells (e.g. the newline/indentation between one
 * `<tr>` and the next) out of the table and up to the document root,
 * rather than leaving it in place. That whitespace is invisible once
 * rendered (it collapses under normal HTML whitespace rules), but it
 * litters the tree with stray top-level text nodes that scale with
 * rows x tables — noise for anything walking the tree, like Step 5's
 * scroll sync.
 *
 * Scoped to direct children of root only: whitespace nested inside
 * elements (between inline nodes, say) is left alone, since it isn't a
 * byproduct of this foster-parenting behaviour and may be meaningful.
 */
export const rehypeStripStrayWhitespace: Plugin<[], Root> = () => (tree) => {
  tree.children = tree.children.filter(
    (child) => !(child.type === 'text' && WHITESPACE_ONLY.test(child.value)),
  )
}

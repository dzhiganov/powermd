import { Decoration, EditorView, ViewPlugin, type DecorationSet } from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'

/**
 * Node types from `@codemirror/lang-markdown` that hold code rather than
 * prose. `FencedCode` covers the whole block including both fence lines —
 * the ```` ```js ```` line is not prose either, so there is nothing to gain
 * by marking only the body. `CodeBlock` is the indented (four-space) form,
 * and `InlineCode` is a `` `backticked` `` span: an identifier is an
 * identifier whether or not it is on its own line.
 */
const CODE_NODES = new Set(['FencedCode', 'CodeBlock', 'InlineCode'])

/**
 * Turns the browser's native spell checker off over code.
 *
 * Spell checking is one `spellcheck` attribute on `.cm-content` (see
 * `useCodeMirror.ts`'s `buildContentAttributes`), so it applies to the whole
 * document — which meant every identifier, keyword and string in a code
 * block got a red squiggle: `createOrder`, `analytics`, `payload`. That is
 * noise in the one region where the "misspellings" are all correct, and it
 * buries real typos in the prose around it.
 *
 * `spellcheck="false"` on a descendant overrides the inherited `true`, so
 * marking the code ranges is enough — the attribute does not need removing
 * from the content element, and prose keeps being checked exactly as before.
 * It also stays correct when the user turns spell check off entirely: false
 * inside false is still false.
 *
 * Decorations are rebuilt for the VISIBLE ranges only, not the whole
 * document. A long document is mostly off-screen, and the browser only spell
 * checks what it renders anyway, so building marks for text nobody is
 * looking at would cost real time on every keystroke to change nothing that
 * is drawn.
 */
const noSpellcheck = Decoration.mark({ attributes: { spellcheck: 'false' } })

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const tree = syntaxTree(view.state)

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (!CODE_NODES.has(node.name)) return true
        // Clipped to the visible range: a block can start far above the
        // viewport, and `RangeSetBuilder` requires ranges in ascending
        // order within it.
        const start = Math.max(node.from, from)
        const end = Math.min(node.to, to)
        if (end > start) builder.add(start, end, noSpellcheck)
        // Do not descend. A fenced block with a language gets a whole
        // sub-tree from that language's own parser, and every node in it
        // sits inside the range just added — descending would try to add
        // overlapping ranges to a builder that requires them sorted and
        // non-nested.
        return false
      },
    })
  }

  return builder.finish()
}

export const codeSpellcheckOff = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }

    update(update: {
      view: EditorView
      docChanged: boolean
      viewportChanged: boolean
      startState: EditorState
      state: EditorState
    }) {
      // The syntax-tree check is not redundant with `docChanged`: markdown
      // is parsed lazily, so the tree can be revised for text that did not
      // change (a long document finishing its parse in the background).
      // Without it, a block that was still unparsed when it scrolled into
      // view would keep its squiggles until the next unrelated edit.
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

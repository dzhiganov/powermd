import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'

export interface FenceCompletion {
  /** Replaces the backtick the user just typed — so it starts with that
   * backtick, then whatever else should follow it. */
  insert: string
  /** Where the cursor lands, counted from the start of `insert`. */
  cursorOffset: number
}

/**
 * Decides whether typing a third backtick should close the fence for you,
 * and what to insert if so. Pure — no view, no document, no syntax tree —
 * so every rule below is directly testable.
 *
 * Result of firing, with `|` as the cursor:
 *
 *     ```|
 *     ```
 *
 * The cursor stays at the END of the opening fence rather than on a blank
 * line between the two. That is the position both flows start from: type a
 * language (`ts`, `bash`) right there, or press Enter once to open the body.
 * Parking it in the middle would make the language — which is what makes a
 * block highlight at all — the awkward case, reachable only by going back up
 * a line.
 */
export function resolveFenceCompletion(options: {
  /** The current line's text, from the line start up to the cursor. */
  before: string
  /** The current line's text, from the cursor to the end of the line. */
  after: string
  /** Whether the cursor already sits inside a fenced code block. */
  insideFencedCode: boolean
}): FenceCompletion | null {
  // Already inside a block, so this third backtick is the user CLOSING it by
  // hand. Auto-closing here would insert a second closing fence and leave a
  // stray one behind — the exact opposite of what they asked for.
  if (options.insideFencedCode) return null

  // Only when the two backticks already typed are alone on the line. Three
  // backticks mid-sentence are not a fence at all (CommonMark requires a
  // fence to open its own line), so "see ```" must stay literal text.
  //
  // Leading whitespace is captured rather than merely tolerated: the closing
  // fence has to be indented to match, or a block written inside a list item
  // does not close where the writer meant it to. Any amount is allowed, not
  // CommonMark's 3-space limit for a top-level fence, precisely because a
  // fence nested in a list is legitimately indented further than that.
  const match = /^([ \t]*)``$/.exec(options.before)
  if (match === null) return null

  // Something already follows the cursor on this line — the user is editing
  // inside existing text, not starting a block, and inserting a newline plus
  // a closing fence would cut that text off from what precedes it.
  if (options.after.trim() !== '') return null

  const indent = match[1]
  return { insert: `\`\n${indent}\`\`\``, cursorOffset: 1 }
}

/** Walks up from `pos` looking for a fenced-code node. `resolveInner` with a
 * side of `-1` looks at what is immediately BEFORE the position, which is
 * what "am I typing inside this" means for a cursor sitting at the end of
 * some text. */
function isInsideFencedCode(state: EditorState, pos: number): boolean {
  const tree = syntaxTree(state)
  // For a large document CodeMirror parses lazily and this tree may stop
  // short of `pos`; resolving past its end reports the top node, i.e.
  // "not in a code block", regardless of the truth. Firing on that would
  // auto-close INSIDE someone's code block. Treating unparsed as
  // "in a block" instead means the worst case is the feature quietly not
  // firing, which is recoverable by typing the fence yourself — unlike
  // corrupting a block you were in the middle of closing.
  if (pos > tree.length) return true

  for (let node = tree.resolveInner(pos, -1); node !== null; node = node.parent as never) {
    if (node.name === 'FencedCode' || node.name === 'CodeText' || node.name === 'CodeBlock') {
      return true
    }
    if (node.parent === null) break
  }
  return false
}

/**
 * Types the closing fence for you when you open one — see
 * `resolveFenceCompletion` for exactly when it fires and why.
 *
 * An `inputHandler`, not a keymap: this is about the CHARACTER produced, so
 * it works on any keyboard layout where a backtick needs a modifier or a
 * dead key, which a `key: '\`'` binding would not. Returning `false` in
 * every other case leaves normal typing completely untouched.
 *
 * The whole thing goes in as ONE transaction tagged `input.type`, so a
 * single undo takes the block back out — landing on the state right before
 * the third backtick, rather than making the user undo twice for something
 * they only did once.
 */
export const codeFenceCompletion = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== '`') return false

  const { state } = view
  // Multiple cursors, or typing over a selection: both would need a per-range
  // answer to "what is on this line", and neither is a plausible way to start
  // a code block. Left to default handling rather than half-supported.
  if (state.selection.ranges.length !== 1 || from !== to) return false

  const line = state.doc.lineAt(from)
  const completion = resolveFenceCompletion({
    before: line.text.slice(0, from - line.from),
    after: line.text.slice(to - line.from),
    insideFencedCode: isInsideFencedCode(state, from),
  })
  if (completion === null) return false

  view.dispatch({
    changes: { from, to, insert: completion.insert },
    selection: { anchor: from + completion.cursorOffset },
    userEvent: 'input.type',
    scrollIntoView: true,
  })
  return true
})

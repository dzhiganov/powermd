import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'

/**
 * Briefly highlights one line — the visual "landed here" confirmation for
 * the modifier-click pane-jump feature (see `src/app/paneJump.ts` and this
 * file's `flashLine` in `lib/scrollHandle.ts`).
 *
 * Kept as a `StateField` (editor *state*), not a one-off DOM class toggle:
 * CodeMirror only renders `.cm-line` elements for the current viewport
 * (plus a small overscan margin) — a jump's target line has usually just
 * been scrolled into view in the same call, and may not exist as a DOM node
 * the instant `flashLine` runs. A decoration lives in state, so CodeMirror
 * applies it correctly whenever that line's `.cm-line` actually gets
 * rendered, regardless of virtualization/scroll timing — the same reason
 * every other per-line marking in this codebase (syntax highlighting,
 * selection) goes through decorations rather than direct DOM writes.
 */
export const flashLineEffect = StateEffect.define<number>()
export const clearFlashEffect = StateEffect.define<null>()

const flashDecoration = Decoration.line({ attributes: { class: 'cm-jump-flash' } })

export const jumpFlashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    // Only ever holds at most one line at a time — a fresh `flashLineEffect`
    // replaces whatever was highlighted before rather than accumulating,
    // so rapid successive jumps just move the highlight instead of leaving
    // a trail.
    let next = decorations.map(tr.changes)
    for (const effect of tr.effects) {
      if (effect.is(flashLineEffect)) {
        next = Decoration.set([flashDecoration.range(effect.value)])
      } else if (effect.is(clearFlashEffect)) {
        next = Decoration.none
      }
    }
    return next
  },
  provide: (field) => EditorView.decorations.from(field),
})

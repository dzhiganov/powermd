import { onMounted, onUnmounted, shallowRef, type Ref } from 'vue'
import { EditorState, Transaction } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'

import { daisyMarkdownTheme } from './theme'

interface UseCodeMirrorOptions {
  /** Initial document text, read once when the view is created. */
  doc: string
  /** Called with the full document string whenever the user edits it. */
  onChange: (value: string) => void
}

/**
 * Owns a CodeMirror 6 `EditorView` for the lifetime of the host component:
 * created in `onMounted` against the given container element, destroyed in
 * `onUnmounted`. Callers never touch the `EditorView` instance directly —
 * `setContent` is the only way to push text into it from the outside,
 * which keeps the store <-> editor sync logic in one place.
 */
export function useCodeMirror(container: Ref<HTMLElement | null>, options: UseCodeMirrorOptions) {
  const view = shallowRef<EditorView | null>(null)

  onMounted(() => {
    if (!container.value) return

    const state = EditorState.create({
      doc: options.doc,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown({ codeLanguages: languages }),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          spellcheck: 'true',
          'aria-label': 'Markdown editor',
        }),
        daisyMarkdownTheme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            options.onChange(update.state.doc.toString())
          }
        }),
      ],
    })

    view.value = new EditorView({
      state,
      parent: container.value,
    })
  })

  onUnmounted(() => {
    view.value?.destroy()
    view.value = null
  })

  /**
   * Replaces the document with `value` if it differs from what the view
   * currently holds. The equality check is what breaks the feedback loop
   * with `onChange`: when a change originates from typing, the value
   * flows editor -> onChange -> store -> back here as the same string,
   * so this is a no-op and the cursor never moves. Only a genuine
   * external change (not exercised until document loading in a later
   * step) reaches the `dispatch` below.
   *
   * The dispatch is excluded from the undo history (`addToHistory: false`):
   * without it, a whole-document swap becomes a single undo step, and one
   * Ctrl+Z after loading a different document restores the *previous*
   * document's text, which then flows back into the store via `onChange`.
   */
  function setContent(value: string) {
    const current = view.value
    if (!current) return
    if (current.state.doc.toString() === value) return

    current.dispatch({
      changes: { from: 0, to: current.state.doc.length, insert: value },
      annotations: [Transaction.addToHistory.of(false)],
    })
  }

  return { setContent }
}

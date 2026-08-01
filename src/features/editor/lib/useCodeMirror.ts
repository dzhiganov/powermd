import { onMounted, onUnmounted, shallowRef, type Ref } from 'vue'
import { Annotation, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'

import { daisyMarkdownTheme } from './theme'
import { imagePasteHandler } from './imagePaste'

/**
 * Marks a dispatched transaction as programmatic so the update listener can
 * skip it (never firing `onChange`, never marking the document dirty). A
 * full-document *load* goes through `EditorState.create` + `view.setState`
 * instead (see `loadDocument`), which produces an update whose
 * `transactions` array is empty — the listener treats that as programmatic
 * too. This annotation covers any future programmatic `dispatch` path.
 */
const programmatic = Annotation.define<boolean>()

interface UseCodeMirrorOptions {
  /** Initial document text, read once when the view is created. */
  doc: string
  /** Called with the full document string whenever the user edits it. */
  onChange: (value: string) => void
  /** Called once, synchronously, right after the `EditorView` is created.
   * Lets a caller (e.g. `Editor.vue`) hand the raw view off to something
   * that immediately wraps it in a narrower interface, without this
   * composable's return type ever having to expose the view itself. */
  onViewReady?: (view: EditorView) => void
  /** Called once, synchronously, right before the view is destroyed. */
  onViewDestroy?: () => void
}

/**
 * Owns a CodeMirror 6 `EditorView` for the lifetime of the host component:
 * created in `onMounted` against the given container element, destroyed in
 * `onUnmounted`. Callers never touch the `EditorView` instance directly —
 * `loadDocument` is the only way to push text into it from the outside,
 * which keeps the store <-> editor sync logic in one place.
 */
export function useCodeMirror(container: Ref<HTMLElement | null>, options: UseCodeMirrorOptions) {
  const view = shallowRef<EditorView | null>(null)
  let resizeObserver: ResizeObserver | null = null

  // Builds a fresh state for `doc`. Reused for the initial mount and for
  // every document load, so both go through exactly the same extension set.
  function createState(doc: string): EditorState {
    return EditorState.create({
      doc,
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
        imagePasteHandler,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return
          // A `view.setState` rebuild (document load, see `loadDocument`)
          // never invokes this listener at all — CodeMirror only calls
          // `updateListener` for updates produced by `dispatch`, and
          // `setState` doesn't go through `dispatch`. So any invocation
          // reaching this point is necessarily a real dispatched
          // transaction; the only remaining case to skip is an explicitly
          // programmatic `dispatch` (the `programmatic` annotation), which
          // must not flow out through `onChange` either.
          const isProgrammatic = update.transactions.some(
            (tr) => tr.annotation(programmatic) === true,
          )
          if (isProgrammatic) return
          options.onChange(update.state.doc.toString())
        }),
      ],
    })
  }

  onMounted(() => {
    if (!container.value) return

    view.value = new EditorView({
      state: createState(options.doc),
      parent: container.value,
    })

    options.onViewReady?.(view.value)

    // CodeMirror only re-measures line wrapping and cursor coordinates
    // when it detects a layout change of its own accord (typing, a DOM
    // mutation it made itself, ...). Resizing the *container* from the
    // outside — a splitter drag, or a view-mode switch that changes which
    // panes are visible — never touches the editor's own DOM, so none of
    // that reaches CodeMirror on its own. A ResizeObserver on the editor's
    // own host element closes that gap entirely inside this feature: the
    // layout feature never needs a cross-feature API to poke the editor
    // after a resize. This also covers the `display:none` <-> `block`
    // transition from the layout feature's `v-show`-based mode switching
    // (never `v-if` — see EditorPane usage), since a box appearing after
    // having none is itself a reported resize (0x0 -> real size).
    resizeObserver = new ResizeObserver(() => {
      view.value?.requestMeasure()
    })
    resizeObserver.observe(container.value)
  })

  onUnmounted(() => {
    resizeObserver?.disconnect()
    resizeObserver = null
    options.onViewDestroy?.()
    view.value?.destroy()
    view.value = null
  })

  /**
   * Loads a different document's text into the editor by rebuilding the
   * whole editor state (`view.setState(EditorState.create(...))`).
   *
   * This is deliberately stronger than dispatching a whole-document replace
   * transaction (even a history-excluded one): rebuilding the state
   * discards CodeMirror's undo history entirely, so a Ctrl+Z immediately
   * after opening document B cannot resurrect document A's text (which
   * would then flow back into the store and silently overwrite B). It also
   * gives the correctness this document-identity change needs for free:
   *
   * - Cursor resets to the top — `EditorState.create` starts the selection
   *   at position 0.
   * - Dirty flag is not raised — `setState` never goes through `dispatch`,
   *   so the update listener above is never invoked for it at all (see
   *   `isProgrammatic`'s comment).
   *
   * `setState` preserves the scroller's DOM `scrollTop`, so it is reset
   * explicitly here to open the document at the very top.
   */
  function loadDocument(value: string) {
    const current = view.value
    if (!current) return
    current.setState(createState(value))
    current.scrollDOM.scrollTop = 0
  }

  return { loadDocument }
}

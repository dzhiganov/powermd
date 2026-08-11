import { onMounted, onUnmounted, shallowRef, type Ref } from 'vue'
import { Annotation, Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'

import { daisyMarkdownTheme } from './theme'
import { imagePasteHandler } from './imagePaste'
import { editorShortcutsKeymap } from './shortcuts'
import { editorSearchExtension } from './search'
import { jumpFlashField } from './jumpFlash'
import { createWikiLinkCompletionExtension } from './wikiLinkCompletion'
import { $wikiLinkDocuments, $activeWikiLinkDocumentId } from '../model/editorEvents'

/**
 * Marks a dispatched transaction as programmatic so the update listener can
 * skip it (never firing `onChange`, never marking the document dirty). A
 * full-document *load* goes through `EditorState.create` + `view.setState`
 * instead (see `loadDocument`), which produces an update whose
 * `transactions` array is empty — the listener treats that as programmatic
 * too. This annotation covers any future programmatic `dispatch` path.
 */
const programmatic = Annotation.define<boolean>()

/**
 * Built once at module scope (not per `createState` call) — the getters
 * inside it always read `$wikiLinkDocuments`/`$activeWikiLinkDocumentId`'s
 * *current* value when CodeMirror calls the completion source, so there is
 * nothing document- or view-specific to rebuild on every mount/`loadDocument`
 * rebuild. Same "built once, reused across every `createState` call" shape
 * as `imagePasteHandler`/`editorSearchExtension` below.
 */
const wikiLinkCompletionExtension = createWikiLinkCompletionExtension(
  () => $wikiLinkDocuments.getState(),
  () => $activeWikiLinkDocumentId.getState(),
)

/** Shape shared by `initialSpellcheck`/`setSpellcheck` below — kept as one
 * object (not two separate enabled/language options) since both values are
 * always applied together, in a single `contentAttributes` reconfigure. */
export interface SpellcheckOptions {
  enabled: boolean
  /** `'default'` means "don't set `lang`" — the content element then
   * inherits the page's own `lang` (see `buildContentAttributes` below).
   * Any other value is applied verbatim as the `lang` attribute. */
  language: string
}

/** Builds the content element's `spellcheck`/`lang`/`aria-label`
 * attributes for a given spell-check preference — the single place this
 * mapping happens, shared by the initial mount and every later
 * `setSpellcheck` reconfigure so the two can never drift apart. */
function buildContentAttributes(spellcheck: SpellcheckOptions): Record<string, string> {
  const attrs: Record<string, string> = {
    spellcheck: String(spellcheck.enabled),
    'aria-label': 'Markdown editor',
  }
  if (spellcheck.language !== 'default') {
    attrs.lang = spellcheck.language
  }
  return attrs
}

interface UseCodeMirrorOptions {
  /** Initial document text, read once when the view is created. */
  doc: string
  /** Initial line-wrap state, read once when the view is created (and
   * again on every `loadDocument` rebuild — see the `currentLineWrap`
   * closure variable below). Later changes go through `setLineWrap`
   * instead, which reconfigures the `Compartment` in place. */
  initialLineWrap: boolean
  /** Initial spell-check state, read once when the view is created (and
   * again on every `loadDocument` rebuild — see the `currentSpellcheck`
   * closure variable below). Later changes go through `setSpellcheck`
   * instead, which reconfigures the `Compartment` in place. */
  initialSpellcheck: SpellcheckOptions
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

  // Line wrapping (Step 8, settings) is a real extension, so toggling it
  // has to go through a `Compartment.reconfigure` dispatch rather than a
  // `view.setState` rebuild — that would discard undo history and reset
  // the cursor, which the document-load path (`loadDocument` below)
  // deliberately does, but a settings toggle must not. `currentLineWrap`
  // tracks the live value across `createState` calls (initial mount *and*
  // every `loadDocument` rebuild) so switching documents never silently
  // reverts a mid-session wrap toggle back to `options.initialLineWrap`.
  const wrapCompartment = new Compartment()
  let currentLineWrap = options.initialLineWrap

  // Same reasoning as `wrapCompartment` above: spell check (Step 8,
  // settings) has to reconfigure in place rather than go through a
  // `view.setState` rebuild, so a toggle or language change never discards
  // undo history or resets the cursor. `currentSpellcheck` tracks the live
  // value across `createState` calls (initial mount *and* every
  // `loadDocument` rebuild) the same way `currentLineWrap` does.
  const spellcheckCompartment = new Compartment()
  let currentSpellcheck = options.initialSpellcheck

  // Builds a fresh state for `doc`. Reused for the initial mount and for
  // every document load, so both go through exactly the same extension set.
  function createState(doc: string): EditorState {
    return EditorState.create({
      doc,
      extensions: [
        history(),
        editorShortcutsKeymap,
        keymap.of([...defaultKeymap, ...historyKeymap]),
        // In-file find & replace (Ctrl+F/Cmd+F) — see `lib/search.ts`'s doc
        // comment for the full rationale, the custom-styled panel, and why
        // its keymap is `Prec.high` (resolves an `Escape` collision with
        // `defaultKeymap`'s `simplifySelection` above, deterministically).
        ...editorSearchExtension,
        markdown({ codeLanguages: languages }),
        wrapCompartment.of(currentLineWrap ? EditorView.lineWrapping : []),
        spellcheckCompartment.of(
          EditorView.contentAttributes.of(buildContentAttributes(currentSpellcheck)),
        ),
        daisyMarkdownTheme,
        imagePasteHandler,
        jumpFlashField,
        wikiLinkCompletionExtension,
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

    // The self-hosted IBM Plex Mono `@font-face`s (`app/styles/main.css`)
    // load asynchronously, same as any web font — `font-display: swap`
    // means CodeMirror's very first layout happens in the fallback
    // monospace stack, then the real font swaps in once it's fetched. That
    // swap changes glyph metrics (and this design's line-height/
    // letter-spacing on top of it), which moves every line's rendered
    // height — but it's not a *container* resize, so the ResizeObserver
    // above never fires for it, and CodeMirror has no other way to notice
    // on its own. Left unhandled, CodeMirror's internal height map (used
    // for cursor placement, scroll-into-view, and `scroll-sync`'s
    // proportional mapping — see `features/scroll-sync`) stays keyed to the
    // fallback font's line height until *something* else happens to trigger
    // a re-measure (typing, a real resize), which measured as ~85% off in
    // this project before. `document.fonts.ready` resolves once every
    // `@font-face` the page requested has finished loading (or failed), so
    // this fires the one `requestMeasure()` needed exactly once, right when
    // the swap actually happens — not a poll, not a guess at a timeout.
    void document.fonts.ready.then(() => {
      view.value?.requestMeasure()
    })
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

  /**
   * Toggles line wrapping on the *live* view via `wrapCompartment.reconfigure`
   * — a plain `dispatch` with only an `effects` entry, no document change and
   * no `setState`. Undo history, cursor position, and scroll are all
   * untouched; only the wrap extension itself swaps in or out.
   */
  function setLineWrap(enabled: boolean) {
    currentLineWrap = enabled
    const current = view.value
    if (!current) return
    current.dispatch({
      effects: wrapCompartment.reconfigure(enabled ? EditorView.lineWrapping : []),
    })
  }

  /**
   * Toggles spell check on/off and/or its language on the *live* view via
   * `spellcheckCompartment.reconfigure` — same shape as `setLineWrap`
   * above: a plain `dispatch` with only an `effects` entry, no document
   * change and no `setState`, so undo history, cursor, and scroll are all
   * untouched. Applying `enabled: false` removes the `spellcheck`
   * attribute's effect immediately (browsers stop checking on the next
   * paint, no reload); a language change re-applies `lang`, which the
   * browser reads to pick a dictionary the *next* time it (re-)checks the
   * content.
   *
   * That "next time it checks" is the catch the attribute flip alone can't
   * fix: browsers only run their spellchecker as text is typed, or when an
   * editable element is (re)initialised — never merely because `spellcheck`
   * went back to `true`. So re-enabling (or changing the language while
   * already on) would otherwise leave text that was on-screen *before* the
   * change unchecked until the user edits it. `forceSpellcheckRescan` below
   * is the deliberate nudge that closes that gap, run only on those two
   * transitions (compared against `previous`, the value this function was
   * last called with) — never on every reconfigure, so an unrelated
   * settings change (or this same value being re-applied) can't trigger it.
   */
  function setSpellcheck(spellcheck: SpellcheckOptions) {
    const previous = currentSpellcheck
    currentSpellcheck = spellcheck
    const current = view.value
    if (!current) return
    current.dispatch({
      effects: spellcheckCompartment.reconfigure(
        EditorView.contentAttributes.of(buildContentAttributes(spellcheck)),
      ),
    })

    const turnedOn = spellcheck.enabled && !previous.enabled
    const languageChangedWhileOn =
      spellcheck.enabled && previous.enabled && spellcheck.language !== previous.language
    if (turnedOn || languageChangedWhileOn) {
      forceSpellcheckRescan(current)
    }
  }

  /**
   * Forces the browser to re-run its spellchecker over text already on
   * screen, by toggling `contentEditable` off and back on — a widely-used
   * nudge that makes the browser treat the element as freshly initialised
   * and re-scan its existing content, without touching the document text
   * or CodeMirror's undo history (`contentEditable` is a plain DOM
   * property, invisible to both).
   *
   * The one thing this toggle *can* disturb is the browser's own selection/
   * focus, so both are explicitly preserved:
   * - If the view already had focus, `EditorView.focus()` (not the raw DOM
   *   `.focus()`) is what puts it back correctly — internally it re-applies
   *   `view.state.selection` to the DOM itself, inside CodeMirror's own
   *   "ignore my own writes" guard (`observer.ignore`), rather than letting
   *   the browser pick wherever it likes to place the caret after a fresh
   *   `contentEditable` toggle. `focusPreventScroll` inside it is also what
   *   keeps this from scrolling the page to bring the editor into view.
   * - If the view was *not* focused, nothing had a selection anchored
   *   inside it to lose, so `focus()` is skipped entirely — this must never
   *   steal focus the editor didn't already have.
   * - `scrollDOM`'s own scroll position is saved/restored around the
   *   toggle regardless, since a `contentEditable` flip can nudge layout
   *   even when the view isn't focused.
   */
  function forceSpellcheckRescan(current: EditorView) {
    const content = current.contentDOM
    const hadFocus = current.hasFocus
    const scrollTop = current.scrollDOM.scrollTop
    const scrollLeft = current.scrollDOM.scrollLeft

    content.contentEditable = 'false'
    content.contentEditable = 'true'

    if (hadFocus) {
      current.focus()
    }

    current.scrollDOM.scrollTop = scrollTop
    current.scrollDOM.scrollLeft = scrollLeft
  }

  /**
   * Asks CodeMirror to re-measure its own layout (line heights, cursor
   * coordinates) without touching the document, cursor, or scroll position
   * — the same call the `document.fonts.ready` handler above already makes
   * for the self-hosted font's async swap. The settings feature's editor
   * font-size/family preferences (`editorFontMetricsChanged`, mirrored in
   * via `wiring.ts`) are the other caller: both change `.cm-scroller`'s
   * rendered line height purely through a CSS custom property, which never
   * fires the container `ResizeObserver` above, so CodeMirror would
   * otherwise never notice.
   */
  function requestMeasure() {
    view.value?.requestMeasure()
  }

  return { loadDocument, setLineWrap, setSpellcheck, requestMeasure }
}

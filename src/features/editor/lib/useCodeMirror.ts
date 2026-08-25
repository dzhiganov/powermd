import { onMounted, onUnmounted, shallowRef, type Ref } from 'vue'
import { Annotation, Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { acceptCompletion, autocompletion, type CompletionSource } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'

import { daisyMarkdownTheme } from './theme'
import { imagePasteHandler } from './imagePaste'
import { editorShortcutsKeymap } from './shortcuts'
import { editorSearchExtension } from './search'
import { jumpFlashField } from './jumpFlash'
import { buildWikiLinkCompletionSource } from './wikiLinkCompletion'
import { buildWordCompletionSource } from './wordCompletion'
import { inlineCompletionTheme } from './completionTheme'
import { indentListItem, outdentListItem } from './listIndent'
import { focusModeExtension } from './focusMode'
import {
  bookmarkMarkersField,
  buildBookmarkGutterExtension,
  readBookmarkPositions,
  setBookmarksEffect,
  type BookmarkMarker,
} from './bookmarkGutter'
import { $wikiLinkDocuments, $activeWikiLinkDocumentId } from '../model/editorEvents'
import {
  bookmarkGutterClicked,
  bookmarkMarkerClicked,
  bookmarkPositionsChanged,
} from '../model/bookmarks'

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
const wikiLinkCompletionSource = buildWikiLinkCompletionSource(
  () => $wikiLinkDocuments.getState(),
  () => $activeWikiLinkDocumentId.getState(),
)

/**
 * Same "built once, reused across every `createState` call" shape as
 * `wikiLinkCompletionSource` above — the callbacks just forward to this
 * feature's own model events (`editor/model/bookmarks.ts`), which is safe
 * to share across every mount/`loadDocument` rebuild since neither callback
 * closes over anything view- or document-specific.
 */
const bookmarkGutterExtension = buildBookmarkGutterExtension({
  onAddRequested: (pos) => bookmarkGutterClicked(pos),
  onMarkerActivated: (id) => bookmarkMarkerClicked(id),
})

/**
 * Same "built once, reused" shape as `wikiLinkCompletionSource` above — the
 * closure-local extraction cache inside it (see `wordCompletion.ts`'s own
 * doc comment) needs to persist across `createState` rebuilds exactly the
 * same way `wikiLinkCompletionSource`'s getters do, otherwise a
 * `loadDocument` call (switching documents) would rebuild a fresh, empty
 * cache anyway — harmless correctness-wise, just throws away a cache entry
 * that's about to be invalidated by the document switch either way.
 */
const wordCompletionSource = buildWordCompletionSource()

/**
 * The two completion sources (`[[Title]]` wiki links, in-document word
 * completion) are registered on a SINGLE `autocompletion()` extension rather
 * than one each. `@codemirror/autocomplete` doesn't support two independent
 * `autocompletion()` instances contributing to two separate menus at once —
 * `override` fully replaces whatever completion sources are active — so one
 * instance with both sources in its `override` list is not just tidier, it
 * is the only way both can coexist at all. Each source is independently
 * responsible for returning `null` when the other's trigger applies (see
 * `wordCompletion.ts`'s own `WIKI_LINK_TRIGGER` check), which is what keeps
 * the two from ever both offering suggestions for the same keystroke.
 *
 * Word completion is the one togglable half (`features/settings`' "Word
 * completion" preference — off by default, see `model/editorPreferences.ts`
 * for why) — wiki-link completion has no such setting and is always
 * included. Returning a fresh extension value (rather than mutating
 * anything) is what makes this safe to feed straight into
 * `wordCompletionCompartment.reconfigure` in `setWordCompletion` below.
 */
function buildCompletionExtension(wordCompletionEnabled: boolean): Extension {
  const sources: CompletionSource[] = wordCompletionEnabled
    ? [wikiLinkCompletionSource, wordCompletionSource]
    : [wikiLinkCompletionSource]
  return [autocompletion({ override: sources, icons: false }), inlineCompletionTheme]
}

/**
 * Tab accepts the currently-highlighted completion, for both menus this
 * feature registers (word completion, wiki links — see
 * `buildCompletionExtension` above; both live on the same `autocompletion()`
 * instance, so one binding covers either). `@codemirror/autocomplete`'s own
 * built-in keymap (installed by `autocompletion()` itself, see
 * `completionKeymap`) only binds Enter -> `acceptCompletion`; this adds the
 * same command under Tab as a second way to accept, without touching that
 * built-in Enter binding at all.
 *
 * `acceptCompletion` returns `false` when no completion is currently
 * selected/active — CodeMirror's keymap dispatch treats a `false` return as
 * "this binding didn't handle the key", so it moves on to the next handler
 * bound to the same key rather than calling `preventDefault`. Below this in
 * `createState`'s extension list, `listIndentKeymap` (see its own doc
 * comment) also binds Tab, to indent a list item — this keymap is placed
 * BEFORE it specifically so completion-accept keeps winning first, same
 * precedence chain either way: accept a completion, else indent a list
 * item, else (`@codemirror/commands`' `indentWithTab` is never installed
 * here) fall all the way through to the browser's own native Tab default —
 * focus moves to the next focusable element after the editor, exactly what
 * Tab did before either feature existed (CodeMirror deliberately ships Tab
 * unbound by default for this reason — binding it is something a host
 * application has to opt into, since leaving it native is what keeps a
 * plain contentEditable surface from becoming a keyboard trap). Verified in
 * the browser: with no completion menu open and the cursor NOT on an
 * indentable list item, Tab still moves focus off the editor.
 *
 * Registered as a plain (non-`Prec`) keymap — no OTHER extension in this
 * file's extension list claims `Tab` (only `listIndentKeymap` does, and
 * ordering between the two plain keymaps is handled by array position, not
 * `Prec`); `@codemirror/autocomplete`'s own Enter binding is internally
 * `Prec.highest`, which this doesn't need to match or beat since the two
 * bindings are on different keys and never compete for the same keydown.
 */
const completionAcceptKeymap = keymap.of([{ key: 'Tab', run: acceptCompletion }])

/**
 * Second link in the Tab precedence chain (`lib/listIndent.ts` owns the
 * feature itself — this is just the binding). `acceptCompletion` above
 * returns `false` whenever no completion is open, which is CodeMirror's
 * "try the next binding for this key" signal; `indentListItem` is that next
 * binding, and returns `false` itself whenever the cursor isn't on an
 * indentable list item (see that module's own doc comment for exactly
 * when), so a Tab that neither accepts a completion nor indents a list item
 * falls through a third and final time, all the way to the browser's native
 * "move focus" default — nothing after this keymap in the extension list
 * binds plain Tab at all.
 *
 * Registered as its own plain (non-`Prec`) `keymap.of`, placed AFTER
 * `completionAcceptKeymap` in `createState`'s `extensions` array below:
 * CodeMirror combines same-precedence `keymap` facet inputs in the order
 * their extensions were provided, tried in that order for a given key, so
 * this only ever runs once `acceptCompletion` has already declined the
 * keypress — completion-accept keeps winning the same key exactly as it did
 * before this feature existed. `Shift-Tab` has no such ordering concern:
 * nothing else in this project binds it (see `completionAcceptKeymap`'s own
 * doc comment above), so `outdentListItem` is simply the only handler.
 */
const listIndentKeymap = keymap.of([
  { key: 'Tab', run: indentListItem },
  { key: 'Shift-Tab', run: outdentListItem },
])

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
  /** Initial word-completion enabled state, read once when the view is
   * created (and again on every `loadDocument` rebuild — see the
   * `currentWordCompletionEnabled` closure variable below). Later changes go
   * through `setWordCompletion` instead, which reconfigures the
   * `Compartment` in place. */
  initialWordCompletionEnabled: boolean
  /** Initial focus-mode enabled state, read once when the view is created
   * (and again on every `loadDocument` rebuild — see the
   * `currentFocusModeEnabled` closure variable below). Later changes go
   * through `setFocusMode` instead, which reconfigures the `Compartment` in
   * place — see `lib/focusMode.ts` for the feature itself. */
  initialFocusModeEnabled: boolean
  /** Initial bookmark marker list for `doc` — read once when the view is
   * created. Later documents loaded via `loadDocument` bring their own
   * bookmark list as an explicit second argument (never a closure
   * variable): unlike every preference above, which changes *while staying
   * on the same document*, a document switch must seed the NEW document's
   * bookmarks atomically with its content, not react to it a tick later —
   * see `loadDocument`'s own doc comment. Live edits (create/recolour/
   * delete a bookmark while staying on the same document) go through
   * `setBookmarks` instead. */
  initialBookmarks: BookmarkMarker[]
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

  // Same reasoning again: word completion (see `buildCompletionExtension`
  // above) is a real extension — swapping it in/out has to reconfigure the
  // Compartment in place, never a `view.setState` rebuild, and
  // `currentWordCompletionEnabled` carries the live value across every
  // `createState` call the same way `currentLineWrap`/`currentSpellcheck` do.
  const completionCompartment = new Compartment()
  let currentWordCompletionEnabled = options.initialWordCompletionEnabled

  // Same reasoning again: focus mode (`lib/focusMode.ts`) is a real
  // `ViewPlugin`/`Decoration` extension — toggling it has to reconfigure the
  // Compartment in place, never a `view.setState` rebuild, so undo history
  // and cursor position survive a toggle exactly like every preference
  // above. `currentFocusModeEnabled` carries the live value across every
  // `createState` call the same way `currentLineWrap`/`currentSpellcheck`/
  // `currentWordCompletionEnabled` do.
  const focusModeCompartment = new Compartment()
  let currentFocusModeEnabled = options.initialFocusModeEnabled

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
        completionCompartment.of(buildCompletionExtension(currentWordCompletionEnabled)),
        focusModeCompartment.of(currentFocusModeEnabled ? focusModeExtension : []),
        // Outside the compartment above (which only carries the
        // TOGGLABLE word-completion source) — Tab must accept a wiki-link
        // completion too, and wiki-link completion is unconditionally
        // present regardless of that toggle (see `buildCompletionExtension`).
        completionAcceptKeymap,
        // Must come AFTER `completionAcceptKeymap` above — see
        // `listIndentKeymap`'s own doc comment for the precedence chain
        // this ordering produces.
        listIndentKeymap,
        // The bookmarks gutter (`lib/bookmarkGutter.ts`) — built once at
        // module scope (see `bookmarkGutterExtension`'s own comment above).
        // Its `bookmarkMarkersField` always starts EMPTY on a fresh state
        // (see that field's own `create`); `loadDocument`/the initial mount
        // below immediately dispatch `setBookmarksEffect` right after
        // creating this state to seed the real list, atomically with the
        // document it belongs to — see `loadDocument`'s own doc comment for
        // why that has to be an explicit second step rather than baked into
        // `create()` via a closure variable.
        bookmarkGutterExtension,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return
          // Bookmark position mapping runs for EVERY document-changing
          // update, including a programmatic one (see `isProgrammatic`
          // below) — whether a bookmark's anchor needs to move depends only
          // on whether the TEXT changed, never on who/what triggered the
          // change (a list-indent command, a task-list toggle, and a
          // keystroke all move text exactly the same way). Reads the
          // ALREADY-MAPPED positions back out of the field (see
          // `readBookmarkPositions`'s own doc comment) — the mapping itself
          // already happened inside `bookmarkMarkersField`'s own `update`,
          // via `RangeSet.map`, before this listener ever runs.
          const positions = readBookmarkPositions(update.state.field(bookmarkMarkersField))
          if (positions.length > 0) bookmarkPositionsChanged(positions)

          // A `view.setState` rebuild (document load, see `loadDocument`)
          // never invokes this listener at all — CodeMirror only calls
          // `updateListener` for updates produced by `dispatch`, and
          // `setState` doesn't go through `dispatch`. So any invocation
          // reaching this point is necessarily a real dispatched
          // transaction; the only remaining case to skip (for `onChange`
          // specifically — bookmark position mapping above already ran
          // regardless) is an explicitly programmatic `dispatch` (the
          // `programmatic` annotation), which must not flow out through
          // `onChange` either.
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

    // Seeds the bookmark gutter for the initial document — `createState`'s
    // `bookmarkMarkersField` always starts empty (see that field's own
    // `create`), so the real list has to be applied as an explicit second
    // step right after the view is created, same as `loadDocument` does for
    // every later document. Skipped when there's nothing to seed, purely to
    // avoid a no-op dispatch on the (very common) "no bookmarks yet" case.
    if (options.initialBookmarks.length > 0) {
      view.value.dispatch({ effects: setBookmarksEffect.of(options.initialBookmarks) })
    }

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
   *
   * `bookmarks` is the NEW document's own bookmark list, seeded via an
   * explicit `setBookmarksEffect` dispatch immediately after the state
   * rebuild — deliberately a parameter here rather than a closure variable
   * read inside `bookmarkMarkersField`'s `create()` (the way
   * `currentLineWrap`/`currentSpellcheck`/etc. above are): those preferences
   * only ever change WHILE STAYING on the same document (a live toggle,
   * reacted to independently of any document switch), so reading a closure
   * variable that "whatever it currently is" is exactly right for them.
   * Bookmarks, by contrast, MUST change atomically with the document being
   * switched to — a closure variable set by a separate, independently-timed
   * caller could race the switch (see `Editor.vue`'s own comment on this),
   * where an explicit parameter passed at the same call site as `value`
   * cannot.
   */
  function loadDocument(value: string, bookmarks: BookmarkMarker[]) {
    const current = view.value
    if (!current) return
    current.setState(createState(value))
    current.scrollDOM.scrollTop = 0
    if (bookmarks.length > 0) {
      current.dispatch({ effects: setBookmarksEffect.of(bookmarks) })
    }
  }

  /**
   * Applies a fresh bookmark list to the *live* view without a `setState`
   * rebuild — a plain `dispatch` with only an `effects` entry (same shape as
   * `setLineWrap` below), so undo history, cursor, and scroll are all
   * untouched. This is the LIVE-EDIT path: creating, recolouring, or
   * deleting a bookmark while staying on the same document. Switching
   * documents goes through `loadDocument`'s own `bookmarks` parameter
   * instead — see that function's doc comment for why the two are kept
   * deliberately separate rather than this function alone covering both.
   */
  function setBookmarks(bookmarks: BookmarkMarker[]) {
    const current = view.value
    if (!current) return
    current.dispatch({ effects: setBookmarksEffect.of(bookmarks) })
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
   * Toggles word completion on the *live* view via
   * `completionCompartment.reconfigure` — same shape as `setLineWrap` above:
   * a plain `dispatch` with only an `effects` entry, no document change and
   * no `setState`. Rebuilds the WHOLE completion extension (both sources,
   * see `buildCompletionExtension`) rather than something narrower, since
   * `override` is the only way `@codemirror/autocomplete` accepts a source
   * list at all — there's no separate "just add/remove one source" API to
   * reach for instead. Wiki-link completion is unaffected either way: it's
   * unconditionally present in `buildCompletionExtension`'s returned list
   * regardless of `enabled`.
   */
  function setWordCompletion(enabled: boolean) {
    currentWordCompletionEnabled = enabled
    const current = view.value
    if (!current) return
    current.dispatch({
      effects: completionCompartment.reconfigure(buildCompletionExtension(enabled)),
    })
  }

  /**
   * Toggles focus mode on the *live* view via
   * `focusModeCompartment.reconfigure` — same shape as `setLineWrap`/
   * `setWordCompletion` above: a plain `dispatch` with only an `effects`
   * entry, no document change and no `setState`, so undo history, cursor,
   * and scroll are all untouched by a toggle. Swaps the WHOLE extension in
   * or out (`focusModeExtension` or `[]`) rather than something narrower —
   * there's nothing partial to reconfigure, the feature is either fully
   * wired in (its `ViewPlugin` starts computing decorations against the
   * view it's handed) or fully absent.
   */
  function setFocusMode(enabled: boolean) {
    currentFocusModeEnabled = enabled
    const current = view.value
    if (!current) return
    current.dispatch({
      effects: focusModeCompartment.reconfigure(enabled ? focusModeExtension : []),
    })
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

  return {
    loadDocument,
    setLineWrap,
    setSpellcheck,
    setWordCompletion,
    setFocusMode,
    setBookmarks,
    requestMeasure,
  }
}

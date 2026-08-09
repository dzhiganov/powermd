import { Prec } from '@codemirror/state'
import { EditorView, keymap, runScopeHandlers, type Panel, type ViewUpdate } from '@codemirror/view'
import {
  search,
  searchKeymap,
  closeSearchPanel,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
  selectMatches,
  getSearchQuery,
  setSearchQuery,
  SearchQuery,
} from '@codemirror/search'

import { searchPanelTheme } from './searchTheme'

/**
 * In-file find & replace (Ctrl+F/Cmd+F — `@codemirror/search`'s own
 * `Mod-f` binding in `searchKeymap` below, no binding of our own needed).
 * Registered as a genuine CodeMirror `keymap`/`search()` extension inside
 * `useCodeMirror.ts`'s `createState`, the same way `editorShortcutsKeymap`
 * is — so, like every other editor shortcut, it only ever fires while the
 * editor's own `contentDOM` has focus. That's what makes "Ctrl+F must not
 * hijack the browser's find when the editor isn't the target" fall out for
 * free: when the editor pane is hidden (`v-show`, preview-only view mode),
 * its `contentDOM` cannot hold focus at all (a `display:none` element isn't
 * focusable), so this keymap never intercepts the keystroke and the
 * browser's native Ctrl+F runs normally.
 *
 * `@codemirror/search`'s default panel (`SearchPanel` inside the package)
 * is unstyled browser-chrome and has no match-count display, so this file
 * supplies a custom one (`MdSearchPanel` below) via `search()`'s
 * `createPanel` option — styled from this app's own design tokens in
 * `./searchTheme.ts` — while reusing every one of the package's own
 * commands (`findNext`/`findPrevious`/`replaceNext`/`replaceAll`/
 * `selectMatches`/`closeSearchPanel`) and its `SearchQuery`/cursor API
 * verbatim, so the actual search/replace *behaviour* (regex, whole-word,
 * case-sensitivity, wrap-around, `$1`-style regex replacement groups) is
 * exactly what the library already ships and tests, not reimplemented here.
 */

/** Match counting is capped, not unbounded — a query that matches nearly
 * every character (e.g. searching for `"e"` in prose) must never turn every
 * keystroke into an unbounded document scan. 999 is comfortably past what
 * a "3 of 47" style counter needs to communicate ("a lot of matches") and
 * cheap to reach even on the largest realistic note in this app — the
 * `documents` feature's own search perf comment (`model/search.ts`) already
 * established that a plain linear scan over in-memory document text is not
 * the bottleneck at this app's scale; this cap is the extra safety margin
 * for the pathological "matches everything" query that measurement didn't
 * specifically cover. */
const MAX_COUNTED_MATCHES = 999

/** Exported (along with `formatMatchCount` below) purely so
 * `search.test.ts` can exercise the count-to-label formatting as a plain
 * pure-function test — same "test the pure logic directly" shape as
 * `shared/lib/relativeTime.test.ts` — without constructing a real
 * `EditorView`/`SearchQuery`, which `countMatches` (the other, genuinely
 * CodeMirror-dependent half) needs. */
export interface MatchCount {
  total: number
  /** 1-based index of the match matching the current selection, or `0` if
   * the selection isn't sitting on a match (query just changed, or the
   * selection was moved by something other than find-next/find-previous). */
  current: number
  capped: boolean
}

function countMatches(view: EditorView, query: SearchQuery): MatchCount {
  if (!query.valid || query.search === '') return { total: 0, current: 0, capped: false }
  const cursor = query.getCursor(view.state)
  const selection = view.state.selection.main
  let total = 0
  let current = 0
  let capped = false
  // `getCursor`'s public type is a plain `Iterator<{from,to}>` (the
  // concrete `SearchCursor`/`RegExpCursor` classes also expose `.value`/
  // `.done` directly, mutated in place, but that's not part of the
  // documented/exported type here) — so matches are read off each `next()`
  // call's own `IteratorResult`, not off the cursor object itself.
  for (let result = cursor.next(); !result.done; result = cursor.next()) {
    total += 1
    if (result.value.from === selection.from && result.value.to === selection.to) {
      current = total
    }
    if (total >= MAX_COUNTED_MATCHES) {
      capped = true
      break
    }
  }
  return { total, current, capped }
}

export function formatMatchCount(count: MatchCount): string {
  if (count.total === 0) return 'No results'
  const totalLabel = count.capped ? `${count.total}+` : `${count.total}`
  if (count.current === 0) return `${totalLabel} result${count.total === 1 ? '' : 's'}`
  return `${count.current} of ${totalLabel}`
}

/** Small, typed alternative to hand-rolling `document.createElement` +
 * property assignment at every call site below — attributes only (event
 * listeners are always wired separately via `addEventListener`, never
 * passed in here), which keeps every handler a plain, named, unbound
 * function reference rather than an inline closure buried in an attributes
 * object. */
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value)
  for (const child of children) {
    el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child)
  }
  return el
}

/**
 * Custom find & replace panel — find, replace, replace all, match case,
 * whole word, regex, next/previous, and a live match count, styled from
 * this app's own tokens (`./searchTheme.ts`) instead of the library's
 * unstyled default. Structurally mirrors `@codemirror/search`'s own
 * `SearchPanel` (same field/button set, same `commit`/`keydown`/`update`/
 * `setQuery`/`mount` shape, same `main-field` attribute the library's
 * `openSearchPanel`/`selectSearchInput` look for) since that shape is the
 * documented contract `search()`'s `createPanel` option expects — only the
 * DOM/CSS and the added match count are this app's own.
 */
class MdSearchPanel implements Panel {
  readonly dom: HTMLElement
  readonly top = true

  private readonly view: EditorView
  private query: SearchQuery
  private readonly searchField: HTMLInputElement
  private readonly replaceField: HTMLInputElement
  private readonly caseField: HTMLInputElement
  private readonly reField: HTMLInputElement
  private readonly wordField: HTMLInputElement
  private readonly countEl: HTMLSpanElement

  constructor(view: EditorView) {
    this.view = view
    this.query = getSearchQuery(view.state)

    this.searchField = h('input', {
      class: 'md-search-field',
      type: 'text',
      placeholder: 'Find',
      'aria-label': 'Find',
      // Read by the library's own `getSearchInput`/`openSearchPanel` —
      // pressing Mod-f again while the panel is already open focuses and
      // selects whichever field carries this attribute, see `search.ts`'s
      // `SearchConfig.createPanel` doc comment.
      'main-field': 'true',
      autocomplete: 'off',
      spellcheck: 'false',
    })
    this.searchField.value = this.query.search

    this.replaceField = h('input', {
      class: 'md-search-field',
      type: 'text',
      placeholder: 'Replace',
      'aria-label': 'Replace',
      autocomplete: 'off',
      spellcheck: 'false',
    })
    this.replaceField.value = this.query.replace

    this.caseField = h('input', { class: 'md-search-checkbox', type: 'checkbox' })
    this.caseField.checked = this.query.caseSensitive
    this.reField = h('input', { class: 'md-search-checkbox', type: 'checkbox' })
    this.reField.checked = this.query.regexp
    this.wordField = h('input', { class: 'md-search-checkbox', type: 'checkbox' })
    this.wordField.checked = this.query.wholeWord

    for (const field of [this.searchField, this.replaceField]) {
      field.addEventListener('change', this.commit)
      // `input`, not `keyup` — the library's own panel uses `keyup`, and it
      // silently misses every way a field's value changes without a key
      // being released in it. Measured: pasting a term with the mouse left
      // the panel reporting the PREVIOUS query's match count until some
      // unrelated key was pressed. Copying an error string and right-click
      // pasting it is an ordinary thing to do. `input` also covers
      // drag-and-drop, IME composition, and autofill, and still fires for
      // ordinary typing — so this is a superset of what `keyup` caught,
      // not a trade.
      field.addEventListener('input', this.commit)
    }
    for (const field of [this.caseField, this.reField, this.wordField]) {
      field.addEventListener('change', this.commit)
    }

    this.countEl = h('span', { class: 'md-search-count', 'aria-live': 'polite' })

    const button = (text: string, ariaLabel: string, onClick: () => void): HTMLButtonElement => {
      const el = h(
        'button',
        { class: 'md-search-button', type: 'button', 'aria-label': ariaLabel },
        [text],
      )
      el.addEventListener('click', onClick)
      return el
    }

    const caseLabel = h('label', { class: 'md-search-check' }, [this.caseField, 'Match case'])
    const reLabel = h('label', { class: 'md-search-check' }, [this.reField, 'Regex'])
    const wordLabel = h('label', { class: 'md-search-check' }, [this.wordField, 'Whole word'])

    const findRow = h('div', { class: 'md-search-row' }, [
      this.searchField,
      this.countEl,
      button('Prev', 'Previous match', () => findPrevious(view)),
      button('Next', 'Next match', () => findNext(view)),
      caseLabel,
      reLabel,
      wordLabel,
    ])

    const rows: HTMLElement[] = [findRow]

    // Mirrors the library's own default panel: no replace UI on a
    // read-only document. This editor is never configured read-only today,
    // but the check costs nothing and keeps this panel correct if that
    // ever changes.
    if (!view.state.readOnly) {
      rows.push(
        h('div', { class: 'md-search-row' }, [
          this.replaceField,
          button('Replace', 'Replace current match', () => replaceNext(view)),
          button('Replace all', 'Replace all matches', () => replaceAll(view)),
          button('Select all', 'Select all matches', () => selectMatches(view)),
        ]),
      )
    }

    const closeButton = h(
      'button',
      { class: 'md-search-close', type: 'button', 'aria-label': 'Close find and replace' },
      ['×'],
    )
    closeButton.addEventListener('click', () => closeSearchPanel(view))

    this.dom = h(
      'div',
      { class: 'md-search-panel', role: 'search', 'aria-label': 'Find in document' },
      [...rows, closeButton],
    )
    this.dom.addEventListener('keydown', (event) => this.keydown(event))

    this.updateCount()
  }

  private readonly commit = (): void => {
    const query = new SearchQuery({
      search: this.searchField.value,
      caseSensitive: this.caseField.checked,
      regexp: this.reField.checked,
      wholeWord: this.wordField.checked,
      replace: this.replaceField.value,
    })
    if (!query.eq(this.query)) {
      this.query = query
      this.view.dispatch({ effects: setSearchQuery.of(query) })
    }
    this.updateCount()
  }

  /**
   * The panel's own DOM lives outside CodeMirror's `contentDOM`, so key
   * events on its inputs never reach the editor's `keymap` extensions on
   * their own — `runScopeHandlers` is the library's documented way to run
   * those bindings (Escape/F3/Mod-g, tagged `scope: "editor search-panel"`
   * in `searchKeymap`) manually for an event that originated here. Enter in
   * either field runs the field's own primary action, same as the
   * library's default panel.
   */
  private keydown(event: KeyboardEvent): void {
    if (runScopeHandlers(this.view, event, 'search-panel')) {
      event.preventDefault()
      return
    }
    if (event.key === 'Enter' && event.target === this.searchField) {
      event.preventDefault()
      ;(event.shiftKey ? findPrevious : findNext)(this.view)
    } else if (event.key === 'Enter' && event.target === this.replaceField) {
      event.preventDefault()
      replaceNext(this.view)
    }
  }

  update(update: ViewUpdate): void {
    for (const tr of update.transactions) {
      for (const effect of tr.effects) {
        if (effect.is(setSearchQuery) && !effect.value.eq(this.query)) {
          this.setQuery(effect.value)
        }
      }
    }
    this.updateCount()
  }

  private setQuery(query: SearchQuery): void {
    this.query = query
    this.searchField.value = query.search
    this.replaceField.value = query.replace
    this.caseField.checked = query.caseSensitive
    this.reField.checked = query.regexp
    this.wordField.checked = query.wholeWord
  }

  private updateCount(): void {
    this.countEl.textContent = formatMatchCount(countMatches(this.view, this.query))
  }

  mount(): void {
    this.searchField.select()
  }
}

/**
 * Bundled as one array (spread directly into `useCodeMirror.ts`'s
 * extension list, same shape as `daisyMarkdownTheme` in `./theme.ts`).
 *
 * `Prec.high` on the keymap (below `editorShortcutsKeymap`'s
 * `Prec.highest` — nothing here binds `Mod-b`/`Mod-i`/`Mod-k`/`Mod-s`/
 * `Mod-Shift-v`/`Mod-/`, so there is no collision to resolve there, but the
 * ordering below still matters for one real collision:
 * `@codemirror/commands`' `defaultKeymap` *also* binds bare `Escape`
 * (`simplifySelection`). Both bindings sit at the same default precedence,
 * so which one runs first for `Escape` is decided by extension order —
 * `Prec.high` here guarantees `searchKeymap`'s `Escape` (`closeSearchPanel`)
 * is tried first regardless of where `defaultKeymap` ends up in
 * `useCodeMirror.ts`'s extension list. When the panel isn't open,
 * `closeSearchPanel` is a no-op (returns `false`), so CodeMirror falls
 * through to `simplifySelection` exactly as before — this only changes
 * behaviour while the panel is actually open, which is the one case that
 * matters: without it, pressing Escape with a multi-range/non-collapsed
 * selection inside the editor (not focused in the panel's own fields)
 * could simplify the selection instead of closing the panel.
 */
export const editorSearchExtension = [
  search({ top: true, createPanel: (view) => new MdSearchPanel(view) }),
  Prec.high(keymap.of(searchKeymap)),
  searchPanelTheme,
]

import { MapMode, RangeSet, StateEffect, StateField, type Range } from '@codemirror/state'
import { EditorView, gutter, GutterMarker } from '@codemirror/view'

/**
 * The editor gutter that shows one coloured circle per bookmark on this
 * document, and turns a click on an EMPTY gutter cell into "add a bookmark
 * here" — the CodeMirror half of the bookmarks feature. Owns exactly the
 * CodeMirror-specific mechanics (the `StateField`, the `GutterMarker`
 * subclass, the DOM click handling); it knows nothing about `documents`'
 * `Bookmark` type, IndexedDB, or Effector outside this file's own two
 * events below — every intent leaves through the `onAddRequested`/
 * `onMarkerActivated` callbacks `buildBookmarkGutterExtension`'s caller
 * supplies (`lib/useCodeMirror.ts`), the same "thin CodeMirror-facing
 * wrapper around a plain callback contract" shape `lib/taskList.ts`'s
 * `toggleTaskListItemAt` and `lib/listIndent.ts`'s commands already use.
 *
 * POSITION MAPPING — the `StateField` below holds a `RangeSet` of point
 * markers (one per bookmark, at its `pos`). Every dispatched transaction
 * maps that set through `tr.changes` via `RangeSet.map`, which is the exact
 * built-in equivalent of `bookmarkPosition.ts`'s own hand-rolled
 * `mapBookmarkPositions` (both use `assoc`/`mapMode` biased backward — see
 * `BookmarkGutterMarker.mapMode` below, set to `MapMode.TrackBefore` so a
 * point range is NEVER dropped by `RangeSet.map`, matching
 * `mapBookmarkPositions`'s own "never silently dropped" documented
 * decision bit-for-bit). The two are kept independently testable (this
 * file needs a live `EditorView`/gutter DOM to exercise at all; the other
 * is a plain function tested directly) precisely because they must never
 * disagree — see `bookmarkPosition.ts`'s doc comment for the full
 * reasoning.
 */

export interface BookmarkMarker {
  id: string
  /** Absolute document offset — see `bookmarkPosition.ts`'s "ANCHOR CHOICE"
   * doc comment for why this is a position, not a line number. */
  pos: number
  /** CSS colour (a hex from `shared/config/bookmarkColors.ts`) — this file
   * never imports that module directly (it would reach outside `editor`
   * into presentation config owned by nothing in particular); the caller
   * resolves the colour id to a hex before handing markers in here, so this
   * stays a plain string this file just paints. */
  color: string
}

class BookmarkGutterMarker extends GutterMarker {
  // Not constructor parameter properties — this project's `tsconfig.app
  // .json` sets `erasableSyntaxOnly`, which forbids that shorthand (it
  // requires the compiler to emit assignment code, not just erase types).
  readonly id: string
  readonly color: string

  constructor(id: string, color: string) {
    super()
    this.id = id
    this.color = color
  }

  // See this file's doc comment — never dropped on deletion, biased to the
  // position just before the deleted span.
  override mapMode = MapMode.TrackBefore

  override eq(other: GutterMarker): boolean {
    return (
      other instanceof BookmarkGutterMarker && other.id === this.id && other.color === this.color
    )
  }

  override toDOM(): Node {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'cm-bookmark-marker'
    button.style.setProperty('--cm-bookmark-color', this.color)
    button.setAttribute('aria-label', 'Edit bookmark')
    button.dataset.bookmarkId = this.id
    return button
  }
}

/** Full replace of the marker set — fired whenever the outside bookmark
 * list for the currently-open document changes (created, deleted, or the
 * document itself was switched), never for a genuine document edit (those
 * are handled by the plain `.map(tr.changes)` in the field's `update`
 * below, with no effect involved at all). */
export const setBookmarksEffect = StateEffect.define<readonly BookmarkMarker[]>()

function buildMarkerRanges(markers: readonly BookmarkMarker[]): Range<GutterMarker>[] {
  // `RangeSet.of` requires ranges sorted by `from` — bookmarks have no
  // inherent order coming in (an Effector store keyed by id), so sort here
  // rather than trusting the caller.
  return [...markers]
    .sort((a, b) => a.pos - b.pos)
    .map((marker) => new BookmarkGutterMarker(marker.id, marker.color).range(marker.pos))
}

export const bookmarkMarkersField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(markers, tr) {
    let next = markers.map(tr.changes)
    for (const effect of tr.effects) {
      if (effect.is(setBookmarksEffect)) next = RangeSet.of(buildMarkerRanges(effect.value))
    }
    return next
  },
})

/**
 * Reads `bookmarkMarkersField`'s current `{ id, pos }` pairs back out of a
 * `RangeSet` — the read half of `setBookmarksEffect`'s write, used by
 * `lib/useCodeMirror.ts`'s `updateListener` after every document-changing
 * transaction to report the freshly REMAPPED positions back out to
 * `editor/model/bookmarks.ts`'s `bookmarkPositionsChanged`.
 * `BookmarkGutterMarker` itself stays module-private (this file is the only
 * place that constructs one) — this is the one sanctioned way anything
 * outside this file learns a marker's `id`/`pos`.
 */
export function readBookmarkPositions(
  markers: RangeSet<GutterMarker>,
): { id: string; pos: number }[] {
  const positions: { id: string; pos: number }[] = []
  const cursor = markers.iter()
  while (cursor.value !== null) {
    if (cursor.value instanceof BookmarkGutterMarker) {
      positions.push({ id: cursor.value.id, pos: cursor.from })
    }
    cursor.next()
  }
  return positions
}

export interface BookmarkGutterCallbacks {
  /** A click landed on a gutter cell with no existing bookmark — `pos` is
   * that line's `line.from`. */
  onAddRequested: (pos: number) => void
  /** A click landed on an existing bookmark marker. */
  onMarkerActivated: (id: string) => void
}

/** Reads the `data-bookmark-id` of an existing marker button under `target`,
 * if any — `target` is the raw DOM event target, which for a marker click
 * is the `<button>` itself (see `BookmarkGutterMarker.toDOM`) but could in
 * principle be a descendant if the marker ever grows child nodes, hence
 * `closest` rather than a direct attribute read. */
function findMarkerId(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null
  return target.closest<HTMLElement>('[data-bookmark-id]')?.dataset.bookmarkId ?? null
}

export function buildBookmarkGutterExtension(callbacks: BookmarkGutterCallbacks) {
  return [
    bookmarkMarkersField,
    gutter({
      class: 'cm-bookmark-gutter',
      markers: (view) => view.state.field(bookmarkMarkersField),
      // `click`, deliberately not `mousedown` — a plain custom `gutter()`
      // (unlike `lineNumbers()`, which has its own separate built-in
      // mousedown-drag-select handling) has no competing default behaviour
      // to pre-empt, so there is no correctness reason to reach for
      // `mousedown` here. There IS a correctness reason to avoid it: adding
      // a bookmark opens `documents/ui/BookmarksIndicator.vue`'s popover
      // (`bookmarkEditorOpenRequested`, via `src/app/bookmarks.ts`), which
      // registers its outside-click dismissal listener the moment it opens.
      // Opening synchronously from `mousedown` still leaves this SAME click
      // gesture's own follow-up `click` event to reach `document` — mousedown
      // and click are dispatched as separate tasks, with a microtask flush
      // (where that listener gets registered) in between — and that `click`
      // lands on the gutter, nowhere near the popover, so it would
      // immediately be treated as an outside click and close the popover
      // the instant it opened (reproduced while building this: the popover
      // visibly flashed open and shut). Opening from `click` instead means
      // the SAME event that opens the popover has already finished
      // capture-phase dispatch by the time the outside-click listener is
      // registered during its own bubble phase — a listener added while an
      // event is being dispatched never fires for that same dispatch, only
      // for a later one (standard DOM event-listener semantics) — so there
      // is no leftover event left to misfire against.
      domEventHandlers: {
        click: (_view, block, event) => {
          const id = findMarkerId(event.target)
          if (id !== null) {
            callbacks.onMarkerActivated(id)
          } else {
            callbacks.onAddRequested(block.from)
          }
          return true
        },
      },
    }),
    bookmarkGutterTheme,
  ]
}

/**
 * Gutter chrome, built from the same DaisyUI custom properties as
 * `lib/theme.ts`'s `daisyEditorTheme` — kept in this file (rather than
 * folded into that one) so the whole bookmarks CodeMirror integration is
 * self-contained in one place, the same way `jumpFlash.ts`'s own decoration
 * styling lives inline in `theme.ts` only because it's a single small rule;
 * this is a whole clickable-target's worth of styling (hover state, focus
 * ring, the circle itself), enough to warrant staying with the feature it
 * belongs to.
 */
const bookmarkGutterTheme = EditorView.theme({
  '.cm-bookmark-gutter': {
    width: '1.1rem',
    cursor: 'pointer',
  },
  '.cm-bookmark-gutter .cm-gutterElement': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  },
  // Every gutter cell (bookmarked or not) shows a faint hover affordance so
  // "you can click here" is discoverable — a real circle only appears once
  // a bookmark exists (see `.cm-bookmark-marker` below); an empty cell's
  // hover dot is deliberately much fainter so it doesn't read as an actual
  // bookmark from a glance.
  '.cm-bookmark-gutter .cm-gutterElement:hover:not(:has(.cm-bookmark-marker))::before': {
    content: '""',
    display: 'block',
    width: '7px',
    height: '7px',
    borderRadius: '999px',
    background: 'var(--color-base-content)',
    opacity: 0.25,
  },
  '.cm-bookmark-marker': {
    display: 'block',
    width: '9px',
    height: '9px',
    borderRadius: '999px',
    border: 'none',
    padding: 0,
    background: 'var(--cm-bookmark-color)',
    cursor: 'pointer',
  },
  '.cm-bookmark-marker:focus-visible': {
    outline: '2px solid var(--md-accent)',
    outlineOffset: '2px',
  },
})

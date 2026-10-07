import { StateField } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'

/**
 * Scroll ahead while typing: once the line you are typing on comes within a
 * few rendered lines of the bottom of the editor, scroll down smoothly so
 * there is still room below it.
 *
 * WHY THIS EXISTS. CodeMirror already keeps the cursor visible — every
 * typing transaction carries `scrollIntoView`, and the default handling
 * scrolls the MINIMUM amount that brings the cursor inside the scroller's
 * box. "Minimum" is the problem: the line being typed ends up flush against
 * the bottom edge and stays pinned there for the rest of the paragraph. In
 * this app that edge is also where the floating status bar and the bottom
 * edge-fade sit (`--md-chrome-bottom`/`--md-edge-fade-bottom` in
 * `app/styles/main.css`), so the text being actively written is the text
 * most likely to be under them.
 *
 * Same "pure core, thin CodeMirror wrapper" split as `focusMode.ts`/
 * `codeFence.ts`: `resolveScrollAhead` below is a plain function of numbers
 * (no view, no DOM, no document) and holds every decision; everything after
 * it is the wiring that measures, and the animation that moves.
 *
 * WHY A `scrollHandler`, NOT A `ViewPlugin.update` + a scroll. The obvious
 * implementation — notice a typing update, then scroll the DOM — loses a
 * race with CodeMirror itself. Its own `scrollIntoView` for that same
 * transaction runs inside the measure cycle AFTER any `requestMeasure`
 * write callback (see `EditorView.measure` in `@codemirror/view`: writes
 * first, `docView.scrollIntoView(this.viewState.scrollTarget)` after), and
 * it applies by assigning `scrollTop`, which would undo this one.
 * `EditorView.scrollHandler` is the facet CodeMirror provides for exactly
 * this: it runs INSTEAD of that default scroll, and returning `true` means
 * "handled, nothing further".
 *
 * Returning `false` is a real fallback, used for every scroll this feature
 * has no opinion about (a jump to a search match, scroll-sync, a document
 * load, or a cursor line too tall to leave room for), and CodeMirror then
 * behaves exactly as it did before this module existed.
 *
 * WHY THE HEIGHT MAP, NOT `coordsAtPos`. A scroll handler runs inside the
 * measure cycle, where `updateState` is `Updating` — and every DOM-reading
 * method on `EditorView` goes through `readMeasured()`, which throws
 * "Reading the editor layout isn't allowed during an update" there. That
 * throw is swallowed by CodeMirror (`logException`, then on to the default
 * scroll), so the first version of this module did nothing at all,
 * silently, with the explanation sitting in the console. `lineBlockAt`
 * reads the height map instead — no layout read, no guard, and already
 * re-measured by this point in the cycle. The cost is granularity: a line
 * block spans ALL the visual rows of a soft-wrapped line, so what is
 * measured is the cursor's LINE, not the cursor's own row. See
 * `resolveScrollAhead`'s fit rule for what that costs and how it stays
 * safe.
 *
 * WHY THIS ANIMATES ITSELF INSTEAD OF USING `behavior: 'smooth'`. Measured,
 * after the browser's own smooth scrolling turned out to be unusable here:
 * a native smooth scroll is ABORTED by the very next keystroke. Setting the
 * DOM selection in a focused `contenteditable` makes Blink reveal the caret
 * instantly, and an instant scroll cancels any programmatic smooth scroll
 * in flight — even when the caret is already visible and the reveal has
 * nothing to do. Instrumented in a real browser: with a keystroke ~10ms
 * after the nudge, `scrollTo({ behavior: 'smooth' })` produced not one
 * `scroll` event and the view stayed exactly where it was; with a second of
 * silence after it, the same call animated the whole way. Typing is the one
 * situation this feature exists for, so "works unless you keep typing" is
 * no good. `ScrollAheadAnimator` below re-asserts the position every frame
 * instead, which nothing cancels — and it makes the in-flight destination
 * exactly knowable rather than something to infer from a lagging
 * `scrollTop`.
 *
 * (`scroll-behavior: smooth` in CSS on `.cm-scroller` is a dead end for a
 * second, independent reason: CodeMirror assigns `scrollTop` and
 * immediately reads it back to learn how far it actually moved
 * (`scrollRectIntoView`). Under smooth behaviour that read-back returns the
 * pre-animation value, so it concludes the scroll did not happen,
 * re-measures, and tries again — the measure loop's "Viewport failed to
 * stabilize" path.)
 */

/** Smallest scroll worth performing. Under a pixel there is nothing to
 * see. */
const MIN_SCROLL_PX = 1

/** Everything `resolveScrollAhead` needs, in one coordinate space: pixels
 * from the top of the scroller's CONTENT (i.e. with `scrollTop` folded in),
 * so the cursor's position here does not change as the view scrolls under
 * it. */
export interface ScrollAheadMeasurement {
  /** Top edge of the line the cursor is on. For a soft-wrapped line this is
   * the top of its FIRST visual row, not the cursor's own row — see the
   * module comment on the height map. */
  cursorLineTop: number
  /** Bottom edge of the line the cursor is on — its last visual row. While
   * typing, that is the cursor's own row, since text is added at the end of
   * what has been typed. */
  cursorLineBottom: number
  /** The scroller's current scroll offset. */
  scrollTop: number
  /** The scroller's visible height. */
  clientHeight: number
  /** The full scrollable height, including `.cm-content`'s own bottom
   * padding (`lib/theme.ts`) — which is what gives the last line of a
   * document anywhere to scroll to at all. */
  scrollHeight: number
  /** Height of one rendered line (`EditorView.defaultLineHeight`). */
  lineHeight: number
  /** Pixels at the bottom of the viewport something else has already
   * claimed — CodeMirror's own `scrollMargins`/`cursorScrollMargin`. Room
   * is kept BEYOND this, never inside it. */
  bottomMargin: number
  /** How many rendered lines of room to keep below the cursor. The user's
   * setting (`features/settings`' "Room below the cursor"). */
  lines: number
  /** Where an animation already running is heading, or `null` when nothing
   * is running. */
  pendingScrollTop: number | null
}

export interface ScrollAheadScroll {
  /** Absolute offset to scroll the scroller to. */
  scrollTop: number
  /** Whether to animate. False for a jump longer than the viewport, where
   * animating would be a long blur with the cursor off-screen for most of
   * it — a big paste rather than typing. */
  smooth: boolean
}

/**
 * Decides whether to scroll, and where to. Returns `null` for "nothing to
 * do here" — which the caller turns into "let CodeMirror handle this scroll
 * the way it always has", so every `null` below defers rather than
 * suppresses.
 *
 * The target is deliberately ABSOLUTE ("put the cursor `desired` pixels
 * above the bottom edge") rather than a delta from the current position.
 * That makes it independent of how far an animation in flight has got,
 * which is what keeps repeated keystrokes on one line converging on a
 * single target instead of walking it further down the document each time.
 */
export function resolveScrollAhead(m: ScrollAheadMeasurement): ScrollAheadScroll | null {
  const desired = m.lines * m.lineHeight + m.bottomMargin

  // THE FIT RULE. What is measured is the cursor's whole line, which for a
  // soft-wrapped line can be many rows tall, and the cursor could be on any
  // of them. Scrolling to put room below such a line's BOTTOM could push its
  // top — and with it, possibly the cursor — off the top of the viewport,
  // which is worse than the problem being solved. Requiring the line to fit
  // in what is left of the viewport once the room is reserved rules that out
  // arithmetically: the target can then never sit above the line's own top.
  //
  // It also subsumes the "cursor is above the viewport" case (a scroll
  // backwards, which CodeMirror should handle, not this): a short line above
  // the viewport leaves more room than `desired` by definition, so the test
  // below returns `null` for it anyway.
  if (m.cursorLineBottom - m.cursorLineTop + desired > m.clientHeight) return null

  // An animation already in flight is treated as having arrived, so the
  // question asked here is always "will there be enough room once this
  // settles" — not "is there enough room right now", which stays false for
  // the whole length of the animation and would re-aim it on every
  // keystroke.
  const settled = Math.max(m.scrollTop, m.pendingScrollTop ?? 0)
  const room = settled + m.clientHeight - m.cursorLineBottom
  if (room >= desired) return null

  // Clamped to the document's own end — `.cm-content`'s bottom padding
  // usually makes the full nudge reachable (see `scrollHeight` above), and
  // where it isn't, scrolling as far as the document goes is the whole of
  // what can be offered.
  const maxScrollTop = Math.max(0, m.scrollHeight - m.clientHeight)
  const scrollTop = Math.min(m.cursorLineBottom + desired - m.clientHeight, maxScrollTop)
  if (scrollTop - m.scrollTop < MIN_SCROLL_PX) return null

  return { scrollTop, smooth: scrollTop - m.scrollTop <= m.clientHeight }
}

// --- CodeMirror wiring -----------------------------------------------------

/**
 * Whether the transaction that most recently touched the document was the
 * user typing into it.
 *
 * The scroll handler below is handed a range and some options, never the
 * transaction that asked for the scroll, so this is how it tells a typing
 * scroll from every other kind. A `StateField` rather than a mutable field
 * on a `ViewPlugin`: it updates with the state itself, so by the time the
 * measure cycle applies that transaction's scroll target, it already
 * describes exactly that transaction.
 *
 * `isUserEvent('input')` covers typing, pasting, dropping and accepting a
 * completion — every way the user ADDS text, including `input.type.compose`
 * for IME input. It deliberately excludes deletions (scrolling down because
 * text was removed would be backwards), undo/redo, and anything
 * programmatic (loading a document, scroll-sync), none of which are user
 * input events at all.
 */
const typedIntoDocument = StateField.define<boolean>({
  create: () => false,
  update: (_, tr) => tr.docChanged && tr.isUserEvent('input'),
})

/** How long a nudge takes. Short enough to stay ahead of continued typing
 * (the room for a new line is wanted by about the time the next line
 * starts), long enough to read as motion rather than a jump. */
const ANIMATION_MS = 180

/** How far the scroller may drift from what this animator last wrote before
 * it concludes something else is in charge of the scroll position and backs
 * out. Two pixels rather than zero because a browser quantizes `scrollTop`
 * to its own fraction of a device pixel. */
const FOREIGN_SCROLL_PX = 2

/**
 * The nudge itself, animated frame by frame — see the module comment on why
 * the browser's own `behavior: 'smooth'` cannot be used for this.
 *
 * Lives in a `ViewPlugin` because it is per-view mutable state with a
 * lifetime: a scroll handler "should never initiate editor updates", so this
 * cannot live in the editor state, and the pending frame has to be released
 * when the view goes away (`destroy`). Carries no `update` method on
 * purpose — nothing about a document or selection change invalidates a
 * scroll in flight; only arriving, being re-aimed, or something else
 * grabbing the scroll position does.
 */
class ScrollAheadAnimator {
  private readonly view: EditorView
  private frame = 0
  private from = 0
  private to: number | null = null
  private startedAt = 0
  /** `null` between being aimed and the first frame that acts on it — see
   * `step`, where that first frame is also what decides where the animation
   * starts from. */
  private lastWritten: number | null = null

  constructor(view: EditorView) {
    this.view = view
  }

  /** Where the animation currently running is heading, or `null` when
   * nothing is running. This is what `resolveScrollAhead` reasons against,
   * and the reason it can be EXACT here rather than inferred from a lagging
   * `scrollTop`. */
  get pendingScrollTop(): number | null {
    return this.to
  }

  /** Aims the animation at `scrollTop`, starting it if it is not already
   * running. Where it animates FROM is deliberately not decided here — see
   * `step`. */
  start(scrollTop: number, smooth: boolean): void {
    if (!smooth || prefersReducedMotion()) {
      this.stop()
      this.view.scrollDOM.scrollTop = scrollTop
      return
    }
    this.to = scrollTop
    this.lastWritten = null
    if (this.frame === 0) this.frame = requestAnimationFrame(this.step)
  }

  private step = (now: number): void => {
    this.frame = 0
    if (this.to === null) return
    const scroller = this.view.scrollDOM

    if (this.lastWritten === null) {
      // First frame since being aimed. Where the animation starts from is
      // read HERE rather than in `start`, because `start` is called from
      // inside CodeMirror's measure cycle and CodeMirror may still move
      // `scrollTop` itself after that — its scroll-anchor correction
      // (`scroll.scrollTop += diff`, which keeps the content under the
      // viewport steady when heights change above it) runs later in the same
      // cycle, and measured at well over the drift tolerance below. Reading
      // the starting point a frame later means that correction is simply
      // where this animation begins, instead of looking like someone else
      // taking over. The destination is unaffected either way: it is derived
      // from the height map, not from the scroll position.
      this.from = scroller.scrollTop
      this.startedAt = now
    } else if (Math.abs(scroller.scrollTop - this.lastWritten) > FOREIGN_SCROLL_PX) {
      // Something else has taken over the scroll position — a wheel or
      // trackpad scroll, a jump to a search match. Whatever it was, it asked
      // for the view to be somewhere specific, and fighting that a frame at a
      // time would be the worst of both.
      this.to = null
      return
    }

    const progress = Math.min(1, (now - this.startedAt) / ANIMATION_MS)
    // Ease-out cubic: most of the distance early, settling gently. An
    // ease-IN would read as hesitation on a nudge this short.
    const eased = 1 - (1 - progress) ** 3
    scroller.scrollTop = this.from + (this.to - this.from) * eased
    // Read back rather than storing what was written: the browser quantizes
    // the value, and the next frame's drift check has to compare against
    // what it actually holds.
    this.lastWritten = scroller.scrollTop

    if (progress >= 1) {
      this.to = null
      return
    }
    this.frame = requestAnimationFrame(this.step)
  }

  private stop(): void {
    if (this.frame !== 0) cancelAnimationFrame(this.frame)
    this.frame = 0
    this.to = null
    this.lastWritten = null
  }

  destroy(): void {
    this.stop()
  }
}

const scrollAheadAnimator = ViewPlugin.define((view) => new ScrollAheadAnimator(view))

/**
 * The same `max`-of-each-edge reduction CodeMirror's own internal
 * `getScrollMargins` performs over this facet, for the one edge this
 * feature cares about. Honoured because returning `true` from a scroll
 * handler skips the default handling that would otherwise apply it —
 * nothing in this app registers a bottom margin today, but a future bottom
 * panel would, and the room is meant to be clear of it, not inside it.
 */
function bottomScrollMargin(view: EditorView): number {
  let bottom = 0
  for (const source of view.state.facet(EditorView.scrollMargins)) {
    const margin = source(view)
    if (margin?.bottom != null) bottom = Math.max(bottom, margin.bottom)
  }
  return bottom
}

/** The animation is the part a reduced-motion preference turns off; the room
 * below the cursor is not. Same split as `theme.ts`'s jump flash and
 * `focusMode.ts`'s dim transition, which both still happen under reduced
 * motion, just instantly. */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Builds the extension `useCodeMirror.ts` keeps behind its
 * `scrollAheadCompartment` — `[]` when the preference is off, this when on,
 * reconfigured live on a change like every other editor preference (never a
 * state rebuild, so undo history and cursor survive it).
 *
 * `lines` is closed over rather than read from a facet: the whole extension
 * is rebuilt when the setting changes anyway, and the only state worth
 * preserving across that rebuild (the animator) is a module-level
 * `ViewPlugin`, which CodeMirror keeps attached to the view across a
 * reconfigure that still includes it.
 */
export function buildScrollAheadExtension(lines: number): Extension {
  return [
    typedIntoDocument,
    scrollAheadAnimator,
    EditorView.scrollHandler.of((view, range, options) => {
      // Only the implicit "keep the cursor visible" scroll that every
      // typing transaction carries. An explicit `scrollIntoView` effect
      // asking for `start`/`center`/`end` (search, pane jump, scroll-sync)
      // is a deliberate request for a specific position — adding room below
      // it would move the very thing the caller asked to see.
      if (options.y !== 'nearest') return false
      if (view.state.field(typedIntoDocument, false) !== true) return false

      // Only ever null if this extension's own plugin is somehow absent,
      // in which case there is nothing here to drive a scroll with and
      // CodeMirror's default is the right answer.
      const animator = view.plugin(scrollAheadAnimator)
      if (animator === null) return false

      const scroller = view.scrollDOM
      // Height-map coordinates start at the top of the first line;
      // `scrollTop === 0` is `documentPadding.top` pixels above that, so the
      // padding is what converts one space to the other. Same conversion
      // `lib/scrollHandle.ts` already does for scroll-sync, which is the
      // other place in this feature that works in scroll space.
      const block = view.lineBlockAt(range.head)
      const padding = view.documentPadding.top
      const decision = resolveScrollAhead({
        cursorLineTop: block.top + padding,
        cursorLineBottom: block.bottom + padding,
        scrollTop: scroller.scrollTop,
        clientHeight: scroller.clientHeight,
        scrollHeight: scroller.scrollHeight,
        lineHeight: view.defaultLineHeight,
        bottomMargin: options.yMargin + bottomScrollMargin(view),
        lines,
        pendingScrollTop: animator.pendingScrollTop,
      })
      if (decision === null) return false

      animator.start(decision.scrollTop, decision.smooth)
      return true
    }),
  ]
}

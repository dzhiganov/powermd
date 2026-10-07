import { describe, it, expect } from 'vitest'

import { resolveScrollAhead, type ScrollAheadMeasurement } from './scrollAhead'

/**
 * One concrete geometry every case below starts from, so each test only
 * states the thing it is actually about.
 *
 * A 600px-tall viewport scrolled to the very top, 20px lines, a 2000px
 * document, and 3 lines (60px) of room asked for. The cursor is on a
 * one-row line ending at 500px — 100px above the bottom edge, which is more
 * room than asked for, so the baseline is "no scroll needed".
 */
function measure(overrides: Partial<ScrollAheadMeasurement> = {}): ScrollAheadMeasurement {
  return {
    cursorLineTop: 480,
    cursorLineBottom: 500,
    scrollTop: 0,
    clientHeight: 600,
    scrollHeight: 2000,
    lineHeight: 20,
    bottomMargin: 0,
    lines: 3,
    pendingScrollTop: null,
    ...overrides,
  }
}

describe('resolveScrollAhead', () => {
  it('leaves a cursor with more room than asked for alone', () => {
    expect(resolveScrollAhead(measure())).toBeNull()
  })

  it('leaves a cursor with exactly the room asked for alone', () => {
    // 60px of room for 3 x 20px lines. Scrolling here would be motion with
    // nothing to gain, on every keystroke.
    expect(resolveScrollAhead(measure({ cursorLineTop: 520, cursorLineBottom: 540 }))).toBeNull()
  })

  it('scrolls so the cursor ends up exactly the room asked for above the edge', () => {
    // Line bottom at 560, so 40px of room where 60px was asked for: the view
    // has to move down the missing 20px.
    const decision = resolveScrollAhead(measure({ cursorLineTop: 540, cursorLineBottom: 560 }))
    expect(decision).toEqual({ scrollTop: 20, smooth: true })
    // Restating the intent the arithmetic encodes: after the scroll, the
    // cursor is `lines * lineHeight` above the bottom edge.
    expect(20 + 600 - 560).toBe(60)
  })

  it('scrolls when the cursor is below the bottom edge entirely', () => {
    // A fresh line pushed past the edge — the ordinary case of pressing
    // Enter at the bottom of the pane.
    expect(resolveScrollAhead(measure({ cursorLineTop: 600, cursorLineBottom: 620 }))).toEqual({
      scrollTop: 80,
      smooth: true,
    })
  })

  it('keeps the room clear of a bottom margin rather than inside it', () => {
    // 30px claimed at the bottom (a panel, or CodeMirror's own cursor
    // margin) means 60 + 30 = 90px of room, so 30px more scrolling than the
    // same cursor needed without it.
    expect(
      resolveScrollAhead(measure({ cursorLineTop: 540, cursorLineBottom: 560, bottomMargin: 30 })),
    ).toEqual({ scrollTop: 50, smooth: true })
  })

  it('scales the room with the number of lines asked for', () => {
    const one = resolveScrollAhead(measure({ cursorLineTop: 580, cursorLineBottom: 600, lines: 1 }))
    const six = resolveScrollAhead(measure({ cursorLineTop: 580, cursorLineBottom: 600, lines: 6 }))
    expect(one).toEqual({ scrollTop: 20, smooth: true })
    expect(six).toEqual({ scrollTop: 120, smooth: true })
  })

  it('stops at the end of the scrollable area', () => {
    // 1400px is as far as a 2000px document scrolls in a 600px viewport. The
    // cursor is at the very end, so the full nudge would need 1460 — what is
    // left is all there is to give, rather than nothing.
    expect(resolveScrollAhead(measure({ cursorLineTop: 1980, cursorLineBottom: 2000 }))).toEqual({
      scrollTop: 1400,
      smooth: false,
    })
  })

  it('does nothing when the document cannot scroll at all', () => {
    // Content shorter than the viewport: the cursor is near the bottom of
    // the pane and there is genuinely nothing below it to bring up. (In the
    // real editor `.cm-content`'s bottom padding means this is rare — it is
    // part of `scrollHeight`, so the last line of a document still has
    // somewhere to scroll to.)
    expect(
      resolveScrollAhead(measure({ cursorLineTop: 580, cursorLineBottom: 600, scrollHeight: 600 })),
    ).toBeNull()
  })

  it('ignores a cursor line above the viewport', () => {
    // Scrolled past the cursor, which is now off the top. Pulling it back
    // down is CodeMirror's own job; answering here would scroll the wrong
    // way. Falls out of the room test — a line above the viewport has the
    // whole viewport below it.
    expect(
      resolveScrollAhead(measure({ cursorLineTop: 100, cursorLineBottom: 120, scrollTop: 400 })),
    ).toBeNull()
  })

  it('acts on a soft-wrapped line that still fits with its room', () => {
    // A 500px-tall wrapped paragraph: 500 + 60 fits inside the 600px
    // viewport, so scrolling to put room below it cannot push its top (and
    // with it, possibly the cursor) off the screen.
    expect(resolveScrollAhead(measure({ cursorLineTop: 600, cursorLineBottom: 1100 }))).toEqual({
      scrollTop: 560,
      smooth: true,
    })
  })

  it('defers when the cursor line is too tall to leave room for', () => {
    // 560px of wrapped line plus 60px of room needs 620px of a 600px
    // viewport. Nothing safe to offer: CodeMirror's own minimum scroll,
    // which works from the cursor's real row rather than its line, is the
    // better answer here.
    expect(resolveScrollAhead(measure({ cursorLineTop: 600, cursorLineBottom: 1160 }))).toBeNull()
  })

  it('counts a scroll already in flight as having arrived', () => {
    // The animation is heading for 80 and has only reached 20. Measured
    // against 20, this cursor looks starved of room and would be nudged
    // again; measured against where the view is going, it already has
    // exactly the 60px asked for.
    expect(
      resolveScrollAhead(
        measure({
          cursorLineTop: 600,
          cursorLineBottom: 620,
          scrollTop: 20,
          pendingScrollTop: 80,
        }),
      ),
    ).toBeNull()
  })

  it('extends a scroll in flight when the cursor moves further down', () => {
    // Same in-flight scroll to 80, but the cursor has moved on a line since
    // (Enter pressed mid-animation). The new target is absolute, not stacked
    // on the old one: 640 + 60 - 600.
    expect(
      resolveScrollAhead(
        measure({
          cursorLineTop: 620,
          cursorLineBottom: 640,
          scrollTop: 20,
          pendingScrollTop: 80,
        }),
      ),
    ).toEqual({ scrollTop: 100, smooth: true })
  })

  it('lands on the same target no matter how far an in-flight scroll has got', () => {
    // The property that keeps fast typing from walking the view down the
    // document: the answer depends on where the cursor is, not on where the
    // animation happens to be when the next keystroke lands.
    const targets = [0, 10, 40, 79].map(
      (scrollTop) =>
        resolveScrollAhead(
          measure({
            cursorLineTop: 640,
            cursorLineBottom: 660,
            scrollTop,
            pendingScrollTop: 80,
          }),
        )?.scrollTop,
    )
    expect(targets).toEqual([120, 120, 120, 120])
  })

  it('jumps rather than animating when the cursor is more than a viewport away', () => {
    // A paste that moved the cursor far down the document. Animating would
    // be most of a second of blur with nothing readable on screen.
    expect(resolveScrollAhead(measure({ cursorLineTop: 1180, cursorLineBottom: 1200 }))).toEqual({
      scrollTop: 660,
      smooth: false,
    })
  })

  it('does nothing for a sub-pixel nudge', () => {
    // 59.5px of room against 60px asked for. Dispatching this would restart
    // a smooth scroll for half a pixel.
    expect(
      resolveScrollAhead(measure({ cursorLineTop: 520.5, cursorLineBottom: 540.5 })),
    ).toBeNull()
  })
})

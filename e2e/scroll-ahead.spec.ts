import { test, expect, type Page } from '@playwright/test'

/**
 * Scroll ahead while typing (`src/features/editor/lib/scrollAhead.ts`):
 * once the line being typed reaches the bottom of the editor, the view
 * scrolls down smoothly so there is still room below it.
 *
 * WHY THIS NEEDS A REAL BROWSER. The decision itself
 * (`resolveScrollAhead`) is pure and unit-tested; what cannot be tested
 * without a live CodeMirror is everything around it — that
 * `EditorView.scrollHandler` is even reached for a typing transaction, that
 * the handler's own measurements land in the same coordinate space the pure
 * function assumes, and that returning `true` really does stop CodeMirror
 * from applying its own minimum scroll on top (which would cancel the
 * smooth one). All three were wrong at some point while building this, and
 * the first version failed in a way no unit test could have caught: the
 * handler threw "Reading the editor layout isn't allowed during an update",
 * CodeMirror logged it and fell back to its default, and the feature simply
 * did nothing.
 *
 * Every assertion below is a MEASUREMENT of the rendered DOM — the distance
 * from the line the browser's own selection is on to the bottom of the real
 * `.cm-scroller` box — never a read of this feature's own arithmetic.
 * Without the feature that distance is ~0 (CodeMirror scrolls the minimum
 * that brings the cursor inside the box); with it, it is the configured
 * number of lines.
 */

/** Long enough to make the editor scroll several viewports at any plausible
 * window height, so "the cursor is at the bottom" is never an artefact of a
 * document that happens to fit. */
const DOCUMENT_LINES = 160

interface Geometry {
  /** The scroller's current offset. */
  scrollTop: number
  /** Distance from the bottom of the cursor's line to the bottom edge of
   * the scroller's visible box — the thing this feature exists to
   * create. */
  roomBelowCursor: number
  /** One rendered line's height, measured off a real line box rather than
   * computed from the font-size/line-height pair, so the expectations below
   * hold at whatever type scale the app is actually using. */
  lineHeight: number
}

async function openApp(page: Page): Promise<void> {
  await page.goto('/')
  await page.locator('.cm-content').waitFor()
}

/**
 * Replaces the document with `DOCUMENT_LINES` numbered lines, leaving the
 * cursor at the end of the last one.
 *
 * `insertText`, not `.type()`: a literal `\n` in `.type()` sends a real
 * Enter keydown, which markdown's own keymap can reshape (list/blockquote
 * continuation) — same reasoning as `focus-mode.spec.ts`'s own note. It
 * also arrives as ONE `input` transaction, which is itself a scroll-ahead
 * trigger, so the seeding already leaves the view where typing at the
 * bottom of a long document would.
 */
async function seedLongDocument(page: Page): Promise<void> {
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Delete')
  const lines = Array.from({ length: DOCUMENT_LINES }, (_, index) => `Line ${index + 1}`)
  await page.keyboard.insertText(lines.join('\n'))
}

/**
 * Moves the cursor to a line partway down the document, with plenty of text
 * still below it, and leaves it resting at the bottom edge of the pane.
 *
 * Arrow keys deliberately: cursor motion is not a document change, so
 * scroll-ahead ignores it entirely (see `typedIntoDocument`) and CodeMirror
 * applies its own minimum scroll — which is exactly the "cursor flush
 * against the bottom edge" starting point these tests want, with none of
 * this feature's behaviour baked into the setup.
 */
async function placeCursorMidDocument(page: Page): Promise<void> {
  await page.keyboard.press('Control+Home')
  for (let step = 0; step < 40; step++) {
    await page.keyboard.press('ArrowDown')
  }
}

/**
 * Measures the line the browser's own selection is on, which is the line
 * the cursor is on.
 *
 * Not the caret element: this project doesn't install CodeMirror's
 * `drawSelection` extension (see `useCodeMirror.ts`'s extension list), so
 * the caret is the browser's native one and there is no `.cm-cursor` in
 * this DOM to measure. Not "the last rendered line" either — CodeMirror
 * renders well past the visible viewport, so partway down a long document
 * the last `.cm-line` in the DOM is a long way below the fold.
 */
function measure(page: Page): Promise<Geometry> {
  return page.evaluate(() => {
    const scroller = document.querySelector('.cm-scroller')
    const lines = document.querySelectorAll('.cm-content .cm-line')
    if (!(scroller instanceof HTMLElement)) throw new Error('editor not mounted')
    if (!(lines[0] instanceof HTMLElement)) throw new Error('no rendered lines to measure')

    const focusNode = window.getSelection()?.focusNode ?? null
    const focusElement = focusNode instanceof Element ? focusNode : focusNode?.parentElement
    const cursorLine = focusElement?.closest('.cm-line')
    if (!(cursorLine instanceof HTMLElement)) {
      throw new Error('no selection inside the editor — is it focused?')
    }

    const box = scroller.getBoundingClientRect()
    return {
      scrollTop: scroller.scrollTop,
      // `box.bottom` is the real bottom edge of the scrollable box. The
      // floating status bar and the bottom edge-fade sit OVER it rather than
      // shortening it, which is exactly why room below the cursor matters
      // here in the first place.
      roomBelowCursor: box.bottom - cursorLine.getBoundingClientRect().bottom,
      // The first rendered line, which is never wrapped in these documents,
      // so its box is one line tall.
      lineHeight: lines[0].getBoundingClientRect().height,
    }
  })
}

/**
 * Waits for scrolling to stop, then measures — polling until `scrollTop`
 * reads the same twice in a row, at an interval deliberately longer than
 * the nudge's whole animation (`ANIMATION_MS` is 180ms in
 * `lib/scrollAhead.ts`), so two equal reads mean it has landed rather than
 * that two samples happened to catch the same frame.
 *
 * NOT `scrollend`, which looks like the right primitive and is not: the
 * nudge is animated frame by frame (see that module's comment on why it
 * cannot use the browser's own smooth scrolling), and Chromium ends a
 * scroll "sequence" between those frames — measured here, it fires
 * mid-animation and reports a position the animation is still moving away
 * from. A stable-reading poll is also what covers "nothing scrolled at all",
 * which is the expected outcome in two of the tests below and fires no
 * event of any kind.
 */
async function settled(page: Page): Promise<Geometry> {
  let previous = Number.NaN
  await expect
    .poll(
      async () => {
        const { scrollTop } = await measure(page)
        // `scrollTop` is quantized to whole pixels by the browser, so
        // "unchanged" is exact here rather than a tolerance.
        const stable = Math.abs(scrollTop - previous) < 1
        previous = scrollTop
        return stable
      },
      { intervals: [250, 250, 250, 500] },
    )
    .toBe(true)
  return measure(page)
}

async function openEditorSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Settings' }).click()
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
}

async function closeSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Close settings' }).click()
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden()
}

test('keeps a few lines of room below the line being typed', async ({ page }) => {
  await openApp(page)
  await seedLongDocument(page)
  await page.keyboard.type('x')

  const { roomBelowCursor, lineHeight } = await settled(page)

  // The default is 3 lines (`DEFAULT_SCROLL_AHEAD_LINES`). Half a line of
  // tolerance on each side absorbs CodeMirror's own small
  // `cursorScrollMargin` and sub-pixel line boxes, while staying far from
  // the ~0 this would measure if the feature were not working.
  expect(roomBelowCursor).toBeGreaterThan(2.5 * lineHeight)
  expect(roomBelowCursor).toBeLessThan(3.5 * lineHeight)
})

test('does not scroll again while the room is already there', async ({ page }) => {
  await openApp(page)
  await seedLongDocument(page)
  await page.keyboard.type('x')
  const before = await settled(page)

  // Four more characters on the same line. The cursor has not moved down, so
  // the room asked for is still there and nothing should move — if the
  // feature scrolled per keystroke instead of per "the cursor ran out of
  // room", the view would creep down the document as you type.
  await page.keyboard.type('yyyy')
  const after = await settled(page)

  expect(after.scrollTop).toBeCloseTo(before.scrollTop, 0)
})

test('follows the cursor down, one line at a time', async ({ page }) => {
  await openApp(page)
  await seedLongDocument(page)
  await page.keyboard.type('x')
  const before = await settled(page)

  // A new line at the bottom of a long document: the cursor takes one line
  // of the room it had, so the view gives back exactly one line of scroll —
  // not a jump to the middle of the pane.
  await page.keyboard.press('Enter')
  await page.keyboard.type('next')
  const after = await settled(page)

  expect(after.scrollTop - before.scrollTop).toBeGreaterThan(0.5 * before.lineHeight)
  expect(after.scrollTop - before.scrollTop).toBeLessThan(1.5 * before.lineHeight)
  // The room is maintained, not spent: without this bound the assertions
  // above would pass just as well on CodeMirror's own minimum scroll, which
  // also advances one line at a time — with zero room, every time.
  expect(after.roomBelowCursor).toBeGreaterThan(2.5 * after.lineHeight)
  expect(Math.abs(after.roomBelowCursor - before.roomBelowCursor)).toBeLessThan(1)
})

test('keeps as much room as the setting asks for', async ({ page }) => {
  await openApp(page)
  await openEditorSettings(page)

  // Driven with real arrow keys rather than a synthetic value assignment:
  // three steps up from the default 3 is 6 lines, and this also proves the
  // slider is reachable and operable from the keyboard.
  const slider = page.getByRole('slider', { name: 'Room below the cursor' })
  await slider.focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(slider).toHaveValue('6')
  await closeSettings(page)

  await seedLongDocument(page)
  // Partway down the document, NOT at its end: what can be scrolled past
  // the last line is `.cm-content`'s own bottom padding (6rem, see
  // `lib/theme.ts`), so at the very end of a document the room is capped at
  // 96px — measured, and correct, but it would cap this 6-line (~166px)
  // setting at about 3.5 lines and prove nothing about the setting.
  await placeCursorMidDocument(page)
  await page.keyboard.type('x')

  const { roomBelowCursor, lineHeight } = await settled(page)
  expect(roomBelowCursor).toBeGreaterThan(5.5 * lineHeight)
  expect(roomBelowCursor).toBeLessThan(6.5 * lineHeight)
})

test('leaves CodeMirror alone when turned off, and remembers that', async ({ page }) => {
  await openApp(page)
  await openEditorSettings(page)
  const toggle = page.getByRole('checkbox', { name: 'Scroll ahead while typing' })
  await expect(toggle).toBeChecked()
  await toggle.click()
  await closeSettings(page)

  await seedLongDocument(page)
  await placeCursorMidDocument(page)
  await page.keyboard.type('x')

  // Back to CodeMirror's own behaviour: the minimum scroll that brings the
  // cursor inside the box, i.e. flush against the bottom edge.
  const off = await settled(page)
  expect(off.roomBelowCursor).toBeLessThan(0.5 * off.lineHeight)

  // The preference is persisted, not just held in memory for the session.
  await page.reload()
  await page.locator('.cm-content').waitFor()
  await openEditorSettings(page)
  await expect(page.getByRole('checkbox', { name: 'Scroll ahead while typing' })).not.toBeChecked()
})

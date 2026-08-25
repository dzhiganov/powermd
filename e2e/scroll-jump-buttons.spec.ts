import { test, expect, type Page } from '@playwright/test'

/**
 * "Jump to top" / "jump to bottom" (`shared/ui/ScrollJumpButtons.vue`),
 * mounted once inside the editor pane and once inside the preview pane
 * (see `Editor.vue`/`Preview.vue`). Default view mode is 'split'
 * (`features/layout/model/layout.ts`), so both panes — and both pairs of
 * buttons — are on screen at once without switching modes first; every
 * test below scopes its locator to one pane's own `<section>` (the same
 * `page.locator('section', { has: ... })` pattern `focus-mode.spec.ts`
 * already uses) so it never accidentally matches the other pane's copy.
 *
 * Multi-line SEEDING goes through `page.keyboard.insertText` in one shot,
 * never `.type()` line by line — same reasoning as every other spec in
 * this directory (a literal `\n` inside `.type()` sends a real Enter
 * keydown, which markdown's own continuation keymap could reshape).
 */

async function openApp(page: Page): Promise<void> {
  await page.goto('/')
  await page.locator('.cm-content').waitFor()
}

async function clearEditor(page: Page): Promise<void> {
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Delete')
}

// 150 blank-line-separated paragraphs — long enough that both the editor
// (~20px/line) and the rendered preview (real wrapped `<p>` elements) are
// comfortably taller than either pane's viewport, in a default 1280x720
// Desktop Chrome window.
const LONG_DOCUMENT = Array.from(
  { length: 150 },
  (_, i) =>
    `Paragraph ${i + 1}: some example sentence, long enough to take up real space on the page.`,
).join('\n\n')

const SHORT_DOCUMENT = 'Just one short line — nowhere near enough to scroll.'

/** Polls `scrollTop` until it stops changing between two checks (up to
 * ~500ms) — used below to wait out CodeMirror's own asynchronous
 * scroll-cursor-into-view before resetting the pane to a known position.
 * Settles immediately (first check) for a scroller with nothing to
 * auto-scroll to, so this is cheap for the short-document case too. */
async function waitForScrollToSettle(page: Page, selector: string): Promise<void> {
  const read = () => page.locator(selector).evaluate((el) => el.scrollTop)
  let previous = await read()
  for (let attempt = 0; attempt < 10; attempt++) {
    await page.waitForTimeout(50)
    const current = await read()
    if (current === previous) return
    previous = current
  }
}

async function seedDocument(page: Page, text: string): Promise<void> {
  await clearEditor(page)
  await page.keyboard.insertText(text)
  // `insertText` leaves the cursor at the end of the inserted text (same
  // note as `focus-mode.spec.ts`'s own seeding helper), and CodeMirror
  // asynchronously scrolls that cursor into view — for a long document,
  // that lands the editor scrolled near the BOTTOM a beat after the
  // transaction itself, not synchronously with it. Waiting for that to
  // actually finish (rather than resetting scrollTop immediately and
  // racing a scroll-into-view still in flight, which would just get
  // clobbered a moment later) is what makes the reset below stick.
  await waitForScrollToSettle(page, '.cm-scroller')
  await page.locator('.cm-scroller').evaluate((el) => {
    el.scrollTop = 0
  })
  await page.evaluate(() => {
    const preview = document.querySelector<HTMLElement>('.markdown-preview')?.parentElement
    if (preview) preview.scrollTop = 0
  })
}

function editorSection(page: Page) {
  return page.locator('section', { has: page.locator('.cm-content') })
}

function previewSection(page: Page) {
  return page.locator('section', { has: page.locator('.markdown-preview') })
}

function editorScroller(page: Page) {
  return page.locator('.cm-scroller')
}

function previewScroller(page: Page) {
  return previewSection(page).locator('div.overflow-y-auto')
}

async function scrollTopOf(locator: ReturnType<typeof editorScroller>): Promise<number> {
  return locator.evaluate((el) => el.scrollTop)
}

async function distanceFromBottom(locator: ReturnType<typeof editorScroller>): Promise<number> {
  return locator.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)
}

/** Records the `behavior` option of every `Element.scrollTo({...})` call
 * made anywhere on the page, from before the app even loads — lets the
 * smooth-vs-reduced-motion decision be asserted directly rather than
 * inferred from animation timing (which a headless browser can resolve
 * fast enough to make a timing-based assertion flaky). */
async function installScrollToSpy(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const behaviors: string[] = []
    ;(window as unknown as { __scrollBehaviors: string[] }).__scrollBehaviors = behaviors
    const original = Element.prototype.scrollTo as (
      this: Element,
      options?: ScrollToOptions,
    ) => void
    const spied = function (this: Element, options?: ScrollToOptions): void {
      if (options && typeof options === 'object' && options.behavior) {
        behaviors.push(options.behavior)
      }
      original.call(this, options)
    }
    Element.prototype.scrollTo = spied as typeof Element.prototype.scrollTo
  })
}

async function recordedScrollBehaviors(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as unknown as { __scrollBehaviors: string[] }).__scrollBehaviors,
  )
}

test.describe('scroll jump buttons — editor pane', () => {
  test('hidden at top, both visible mid-scroll, correct at the bottom — and the buttons actually scroll', async ({
    page,
  }) => {
    await openApp(page)
    await seedDocument(page, LONG_DOCUMENT)

    const section = editorSection(page)
    const top = section.getByRole('button', { name: 'Scroll to top' })
    const bottom = section.getByRole('button', { name: 'Scroll to bottom' })
    const scroller = editorScroller(page)

    // At the very top: "top" absent (would do nothing), "bottom" present.
    await expect(top).toBeHidden()
    await expect(bottom).toBeVisible()

    await bottom.click()
    await expect.poll(() => distanceFromBottom(scroller)).toBeLessThan(3)

    // At the very bottom: "bottom" absent, "top" present.
    await expect(bottom).toBeHidden()
    await expect(top).toBeVisible()

    // Somewhere in the middle: both present.
    await scroller.evaluate((el) => {
      el.scrollTop = Math.floor((el.scrollHeight - el.clientHeight) / 2)
    })
    await expect(top).toBeVisible()
    await expect(bottom).toBeVisible()

    await top.click()
    await expect.poll(() => scrollTopOf(scroller)).toBeLessThan(3)
    await expect(top).toBeHidden()
    await expect(bottom).toBeVisible()
  })

  test('both buttons are absent when the document is too short to scroll', async ({ page }) => {
    await openApp(page)
    await seedDocument(page, SHORT_DOCUMENT)

    const section = editorSection(page)
    await expect(section.getByRole('button', { name: 'Scroll to top' })).toBeHidden()
    await expect(section.getByRole('button', { name: 'Scroll to bottom' })).toBeHidden()
  })

  test('keyboard accessible: Tab reaches the button, Enter activates it', async ({ page }) => {
    await openApp(page)
    await seedDocument(page, LONG_DOCUMENT)

    const section = editorSection(page)
    const bottom = section.getByRole('button', { name: 'Scroll to bottom' })
    await bottom.focus()
    await expect(bottom).toBeFocused()

    await page.keyboard.press('Enter')
    const scroller = editorScroller(page)
    await expect.poll(() => distanceFromBottom(scroller)).toBeLessThan(3)
  })

  test('genuinely painted — nonzero opacity, and its own centre hit-tests to itself, clear of the bookmark gutter', async ({
    page,
  }) => {
    await openApp(page)
    await seedDocument(page, LONG_DOCUMENT)

    const section = editorSection(page)
    const bottom = section.getByRole('button', { name: 'Scroll to bottom' })
    await expect(bottom).toBeVisible()

    const opacity = await bottom.evaluate((el) => Number(getComputedStyle(el).opacity))
    expect(opacity).toBeGreaterThan(0)

    const box = await bottom.boundingBox()
    expect(box).not.toBeNull()
    if (box === null) return
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    const hitLabel = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label'),
      centre,
    )
    expect(hitLabel).toBe('Scroll to bottom')

    // Clear of the bookmark gutter, which is pinned to the editor's left
    // edge for the pane's full height — the button must sit well to the
    // right of it, not just avoid exact pixel overlap.
    const gutterBox = await page.locator('.cm-bookmark-gutter').first().boundingBox()
    expect(gutterBox).not.toBeNull()
    if (gutterBox !== null) {
      expect(box.x).toBeGreaterThan(gutterBox.x + gutterBox.width)
    }
  })
})

test.describe('scroll jump buttons — preview pane', () => {
  test('hidden at top, both visible mid-scroll, correct at the bottom — and the buttons actually scroll', async ({
    page,
  }) => {
    await openApp(page)
    await seedDocument(page, LONG_DOCUMENT)

    const section = previewSection(page)
    const top = section.getByRole('button', { name: 'Scroll to top' })
    const bottom = section.getByRole('button', { name: 'Scroll to bottom' })
    const scroller = previewScroller(page)
    await expect(scroller.locator('.markdown-preview p').first()).toBeVisible()

    await expect(top).toBeHidden()
    await expect(bottom).toBeVisible()

    await bottom.click()
    await expect.poll(() => distanceFromBottom(scroller)).toBeLessThan(3)

    await expect(bottom).toBeHidden()
    await expect(top).toBeVisible()

    await scroller.evaluate((el) => {
      el.scrollTop = Math.floor((el.scrollHeight - el.clientHeight) / 2)
    })
    await expect(top).toBeVisible()
    await expect(bottom).toBeVisible()

    await top.click()
    await expect.poll(() => scrollTopOf(scroller)).toBeLessThan(3)
    await expect(top).toBeHidden()
    await expect(bottom).toBeVisible()
  })

  test('both buttons are absent when the document is too short to scroll', async ({ page }) => {
    await openApp(page)
    await seedDocument(page, SHORT_DOCUMENT)

    const section = previewSection(page)
    await expect(section.getByRole('button', { name: 'Scroll to top' })).toBeHidden()
    await expect(section.getByRole('button', { name: 'Scroll to bottom' })).toBeHidden()
  })

  test('appears once content grows past the visible area without the pane itself scrolling', async ({
    page,
  }) => {
    // Starts short (nothing to scroll), then grows past the fold entirely
    // via a document edit — no scroll event of its own fires for that, so
    // this is what proves the MutationObserver path (not just the 'scroll'
    // listener) keeps the buttons correct.
    await openApp(page)
    await seedDocument(page, SHORT_DOCUMENT)

    const section = previewSection(page)
    const bottom = section.getByRole('button', { name: 'Scroll to bottom' })
    await expect(bottom).toBeHidden()

    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.insertText('\n\n' + LONG_DOCUMENT)

    await expect(bottom).toBeVisible()
  })
})

test.describe('scroll jump buttons — motion', () => {
  test('scrolls smoothly by default', async ({ page }) => {
    await installScrollToSpy(page)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await openApp(page)
    await seedDocument(page, LONG_DOCUMENT)

    await editorSection(page).getByRole('button', { name: 'Scroll to bottom' }).click()
    const behaviors = await recordedScrollBehaviors(page)
    expect(behaviors).toContain('smooth')
    expect(behaviors).not.toContain('auto')
  })

  test('scrolls instantly under prefers-reduced-motion: reduce', async ({ page }) => {
    await installScrollToSpy(page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openApp(page)
    await seedDocument(page, LONG_DOCUMENT)

    await editorSection(page).getByRole('button', { name: 'Scroll to bottom' }).click()
    const behaviors = await recordedScrollBehaviors(page)
    expect(behaviors).toContain('auto')
    expect(behaviors).not.toContain('smooth')
  })
})

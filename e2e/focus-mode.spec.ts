import { test, expect, type Page } from '@playwright/test'

/**
 * Focus mode dims every editor line except the paragraph the cursor is in
 * (`src/features/editor/lib/focusMode.ts`). Assertions here go through
 * computed styles/classes, never screenshots — same reasoning as every other
 * spec in this directory (a real Playwright tab has `document.hidden ===
 * false`, unlike the CDP-attached pane used for manual verification, but
 * screenshot-diffing is still brittle across environments in a way computed
 * styles aren't).
 *
 * Multi-paragraph SEEDING goes through `page.keyboard.insertText` in one
 * shot, never `.type()` line by line — same reasoning as
 * `list-indent.spec.ts`'s own doc comment: a literal `\n` inside `.type()`
 * sends a real Enter keydown, which `markdownKeymap`'s
 * `insertNewlineContinueMarkup` could reshape (list auto-continuation,
 * blockquote continuation), corrupting the seeded document. `insertText`
 * inserts as a single transaction with no such side effect, and leaves the
 * cursor at the end of the inserted text.
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

/** Opens Settings (Editor category, where "Focus mode" lives) and sets it to
 * the given on/off state, idempotently — same shape as
 * `word-completion.spec.ts`'s own `setWordCompletionSetting`. */
async function setFocusModeSetting(page: Page, enabled: boolean): Promise<void> {
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Settings' }).click()
  const checkbox = page.getByRole('checkbox', { name: 'Focus mode' })
  await checkbox.waitFor()
  const isChecked = await checkbox.isChecked()
  if (isChecked !== enabled) {
    await checkbox.click()
  }
  await page.getByRole('button', { name: 'Close settings' }).click()
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden()
}

function editorLines(page: Page) {
  return page.locator('.cm-content .cm-line')
}

/**
 * Parses a computed `color` string down to a plain `[r, g, b]` (0-255,
 * rounded) tuple, handling BOTH forms Chromium's computed-style serializer
 * hands back in this suite: the legacy `rgb(r, g, b)` a plain colour literal
 * serializes as, and `color(srgb r g b)` (channels 0-1) — which is what a
 * `color-mix()` result serializes as, EVEN at a mixing level (100%) that
 * makes it numerically identical to a plain colour with no actual mixing.
 * Comparing those two forms with a bare string `===`/`toBe` fails on syntax
 * alone despite being the exact same colour (canvas's own `fillStyle`
 * getter/setter round-trip was tried first and turned out NOT to normalize
 * this pair to one shared syntax either — it preserves `color(srgb ...)`
 * verbatim rather than folding it back to hex/rgb — so this does the
 * arithmetic by hand instead of trusting a browser API to unify them).
 */
async function normalizedColor(page: Page, color: string): Promise<[number, number, number]> {
  return page.evaluate((value) => {
    const legacy = value.match(/^rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/)
    if (legacy) {
      return [Number(legacy[1]), Number(legacy[2]), Number(legacy[3])] as [number, number, number]
    }
    const modern = value.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/)
    if (modern) {
      return [
        Math.round(Number(modern[1]) * 255),
        Math.round(Number(modern[2]) * 255),
        Math.round(Number(modern[3]) * 255),
      ] as [number, number, number]
    }
    throw new Error(`Unrecognized colour format: ${value}`)
  }, color)
}

/**
 * Three paragraphs, blank-line separated:
 *   line 1-2: "paragraph one" (two lines)
 *   line 3:   blank
 *   line 4:   "paragraph two" (one line)
 *   line 5:   blank
 *   line 6-7: "paragraph three" (two lines)
 * `insertText` leaves the cursor at the very end — inside paragraph three.
 */
const THREE_PARAGRAPHS = [
  'paragraph one line one',
  'paragraph one line two',
  '',
  'paragraph two',
  '',
  'paragraph three line one',
  'paragraph three line two',
].join('\n')

async function seedThreeParagraphs(page: Page): Promise<void> {
  await clearEditor(page)
  await page.keyboard.insertText(THREE_PARAGRAPHS)
}

test.describe('focus mode', () => {
  test('off by default — no line is dimmed', async ({ page }) => {
    await openApp(page)
    await seedThreeParagraphs(page)
    await expect(page.locator('.cm-focus-dim')).toHaveCount(0)
  })

  test('dims every paragraph except the one the cursor is in', async ({ page }) => {
    await openApp(page)
    await setFocusModeSetting(page, true)
    await seedThreeParagraphs(page)

    const lines = editorLines(page)
    // Cursor is at the end of the seeded text — inside paragraph three
    // (lines 6-7, 0-based indices 5-6).
    await expect(lines.nth(0)).toHaveClass(/cm-focus-dim/) // paragraph one, line 1
    await expect(lines.nth(1)).toHaveClass(/cm-focus-dim/) // paragraph one, line 2
    await expect(lines.nth(3)).toHaveClass(/cm-focus-dim/) // paragraph two
    await expect(lines.nth(5)).not.toHaveClass(/cm-focus-dim/) // paragraph three, line 1
    await expect(lines.nth(6)).not.toHaveClass(/cm-focus-dim/) // paragraph three, line 2

    // The dim isn't just a class — the computed text colour is actually
    // reduced-contrast, and uniform across every dimmed line, not just one
    // of them.
    const dimColorA = await lines.nth(0).evaluate((el) => getComputedStyle(el).color)
    const dimColorB = await lines.nth(3).evaluate((el) => getComputedStyle(el).color)
    const activeColor = await lines.nth(5).evaluate((el) => getComputedStyle(el).color)
    expect(dimColorA).toBe(dimColorB)
    expect(dimColorA).not.toBe(activeColor)
  })

  test('moving the cursor to another paragraph moves the undimmed region', async ({ page }) => {
    await openApp(page)
    await setFocusModeSetting(page, true)
    await seedThreeParagraphs(page)

    const lines = editorLines(page)
    // Starting state: paragraph three (lines 6-7) is active.
    await expect(lines.nth(6)).not.toHaveClass(/cm-focus-dim/)
    await expect(lines.nth(0)).toHaveClass(/cm-focus-dim/)

    // Jump to the very start of the document — paragraph one.
    await page.keyboard.press('Control+Home')

    await expect(lines.nth(0)).not.toHaveClass(/cm-focus-dim/)
    await expect(lines.nth(1)).not.toHaveClass(/cm-focus-dim/)
    // Paragraph three, previously active, is now dimmed.
    await expect(lines.nth(5)).toHaveClass(/cm-focus-dim/)
    await expect(lines.nth(6)).toHaveClass(/cm-focus-dim/)
    // Paragraph two, never active in this test, stays dimmed throughout.
    await expect(lines.nth(3)).toHaveClass(/cm-focus-dim/)
  })

  test('turning the setting off removes every dim — nothing stays highlighted', async ({
    page,
  }) => {
    await openApp(page)
    await setFocusModeSetting(page, true)
    await seedThreeParagraphs(page)
    await expect(page.locator('.cm-focus-dim')).not.toHaveCount(0)

    await setFocusModeSetting(page, false)
    await expect(page.locator('.cm-focus-dim')).toHaveCount(0)
    // The document itself is untouched by the toggle.
    await expect(page.locator('.cm-content')).toContainText('paragraph three line two')
  })

  test('toggling the setting live does not lose undo history or the cursor', async ({ page }) => {
    await openApp(page)
    await clearEditor(page)

    // Real keystrokes (not `insertText`) so this builds genuine undo
    // history, the same way a user's own typing would.
    await page.keyboard.type('hello world')
    await expect(page.locator('.cm-content')).toHaveText('hello world')

    await setFocusModeSetting(page, true)
    // The Compartment reconfigure must not have touched the document or
    // discarded the typed text.
    await expect(page.locator('.cm-content')).toHaveText('hello world')

    await setFocusModeSetting(page, false)
    await expect(page.locator('.cm-content')).toHaveText('hello world')

    // CURSOR: typing one more character lands it appended at the very end
    // ("hello world!"), proving the cursor is still where it was (the end of
    // "hello world") rather than reset to the document start — a
    // `view.setState` rebuild (document load) always resets the cursor to
    // position 0, which this Compartment-based toggle must not do.
    await page.locator('.cm-content').click()
    await page.keyboard.type('!')
    await expect(page.locator('.cm-content')).toHaveText('hello world!')

    // UNDO HISTORY: a single Ctrl+Z must still have an effect — a
    // `view.setState` rebuild discards undo history entirely, which would
    // make this a no-op and leave the text unchanged.
    await page.keyboard.press('Control+z')
    await expect(page.locator('.cm-content')).not.toHaveText('hello world!')
  })

  test('the preview pane is never dimmed', async ({ page }) => {
    await openApp(page)
    await setFocusModeSetting(page, true)
    await seedThreeParagraphs(page)

    await page.getByRole('button', { name: 'Split', exact: true }).click()
    const preview = page.locator('.markdown-preview')
    await expect(preview).toContainText('paragraph one line one')

    // No CodeMirror dim class ever reaches the preview — it isn't even the
    // same DOM subtree — and the preview's own paragraph text must not be
    // painted in the editor's dimmed tone either.
    await expect(page.locator('.markdown-preview .cm-focus-dim')).toHaveCount(0)

    const dimmedEditorColor = await editorLines(page)
      .nth(0)
      .evaluate((el) => getComputedStyle(el).color)
    const previewParagraphColor = await preview
      .locator('p')
      .first()
      .evaluate((el) => getComputedStyle(el).color)
    expect(previewParagraphColor).not.toBe(dimmedEditorColor)
  })

  test('printing hides the editor entirely, so print output is never dimmed', async ({ page }) => {
    await openApp(page)
    await setFocusModeSetting(page, true)
    await seedThreeParagraphs(page)

    await page.emulateMedia({ media: 'print' })
    // `EditorPane.vue` is `print:hidden` — the whole editor (and every
    // `.cm-focus-dim` line inside it) is removed from the print rendering
    // regardless of this feature; only the preview pane ever prints.
    const editorPane = page.locator('section', { has: page.locator('.cm-content') })
    await expect(editorPane).toHaveCSS('display', 'none')
  })

  test.describe('dim level slider', () => {
    // Opens Settings (Editor category) without touching Focus mode itself —
    // separate from `setFocusModeSetting` above, which always closes the
    // dialog again; these tests need it open to reach the slider.
    async function openSettings(page: Page): Promise<void> {
      await page.getByRole('button', { name: 'More actions' }).click()
      await page.getByRole('menuitem', { name: 'Settings' }).click()
    }

    function dimLevelSlider(page: Page) {
      return page.getByRole('slider', { name: 'Focus dim level' })
    }

    test('is present, interactive, and reachable when focus mode is off', async ({ page }) => {
      await openApp(page)
      await openSettings(page)
      const slider = dimLevelSlider(page)
      await expect(slider).toBeVisible()
      // Not disabled — same "stays interactive, a caption explains it has no
      // effect yet" pattern as the per-folder word-completion exclusion list
      // while word completion itself is off (see `SettingsModal.vue`'s own
      // comment on this control).
      await expect(slider).toBeEnabled()
      await expect(
        page.getByText('Focus mode is off right now, so this has no visible effect'),
      ).toBeVisible()
    })

    test('the explanatory caption disappears once focus mode is on', async ({ page }) => {
      await openApp(page)
      await setFocusModeSetting(page, true)
      await openSettings(page)
      await expect(
        page.getByText('Focus mode is off right now, so this has no visible effect'),
      ).toHaveCount(0)
    })

    test('moving the slider changes the rendered dim colour live, with no reload', async ({
      page,
    }) => {
      await openApp(page)
      await setFocusModeSetting(page, true)
      await seedThreeParagraphs(page)

      const lines = editorLines(page)
      const activeColor = await lines.nth(5).evaluate((el) => getComputedStyle(el).color)
      const dimColorAtDefault = await lines.nth(0).evaluate((el) => getComputedStyle(el).color)
      // The default (65) is a real dim, distinct from full-strength text.
      expect(dimColorAtDefault).not.toBe(activeColor)

      await openSettings(page)
      const slider = dimLevelSlider(page)
      await slider.waitFor()

      // `Home` jumps a focused native range input to its `min` attribute —
      // `FOCUS_DIM_LEVEL_MIN` (10). Deliberately far below the WCAG AA floor
      // the rest of this app holds to: focus mode's purpose is to push the
      // surrounding text out of attention, and it is a reversible personal
      // preference rather than published content. 10 and not 0 because 0 is
      // the background colour exactly — invisible, not dim. See that
      // constant's own comment.
      await slider.focus()
      await slider.press('Home')
      await expect(page.getByText('Focus dim level — 10%')).toBeVisible()
      await page.getByRole('button', { name: 'Close settings' }).click()
      const dimColorAtMin = await lines.nth(0).evaluate((el) => getComputedStyle(el).color)
      expect(dimColorAtMin).not.toBe(dimColorAtDefault)
      expect(dimColorAtMin).not.toBe(activeColor)

      // `End` jumps to `max` (100) — full-strength `--color-base-content`,
      // i.e. no mixing at all, so the "dimmed" line's colour should now
      // match the active paragraph's own (undimmed) colour exactly.
      await openSettings(page)
      await slider.focus()
      await slider.press('End')
      await expect(page.getByText('Focus dim level — 100%')).toBeVisible()
      await page.getByRole('button', { name: 'Close settings' }).click()
      const dimColorAtMax = await lines.nth(0).evaluate((el) => getComputedStyle(el).color)
      expect(dimColorAtMax).not.toBe(dimColorAtMin)
      // Not a bare string `toBe` — `color-mix()`'s computed-style
      // serialization uses `color(srgb ...)` even at 100% (no actual
      // mixing), while `activeColor` is a plain `rgb(...)` literal. Same
      // colour, different notation — see `normalizedColor`'s own comment.
      expect(await normalizedColor(page, dimColorAtMax)).toEqual(
        await normalizedColor(page, activeColor),
      )
    })

    test('persists across reload and is included in "Reset to defaults"', async ({ page }) => {
      await openApp(page)
      await openSettings(page)
      const slider = dimLevelSlider(page)
      await slider.waitFor()
      await slider.focus()
      await slider.press('Home')
      await expect(page.getByText('Focus dim level — 10%')).toBeVisible()
      await page.getByRole('button', { name: 'Close settings' }).click()

      await page.reload()
      await openApp(page)
      await openSettings(page)
      await expect(page.getByText('Focus dim level — 10%')).toBeVisible()

      await page.getByRole('button', { name: 'Reset to defaults' }).click()
      await page.getByRole('button', { name: 'Reset', exact: true }).click()
      await expect(page.getByText('Focus dim level — 65%')).toBeVisible()
    })
  })
})

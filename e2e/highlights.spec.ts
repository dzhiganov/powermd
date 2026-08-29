import { test, expect, type Page } from '@playwright/test'

/**
 * Text highlights (`features/highlights`), end to end.
 *
 * The re-anchoring rules are unit-tested in `editor/lib/highlightRanges.
 * test.ts`, where each case can be stated directly. What only a real run can
 * show is the round trip: a selection in CodeMirror producing a toolbar at
 * the right place, a click painting a decoration, the panel listing it, and —
 * the part with the most moving pieces — all of that surviving a reload,
 * which means it genuinely reached IndexedDB.
 */

async function openApp(page: Page): Promise<void> {
  await page.goto('/')
  await page.locator('.cm-content').waitFor()
}

async function setDoc(page: Page, text: string): Promise<void> {
  await page.locator('.cm-content').fill(text)
  await page.waitForTimeout(400)
}

/**
 * Selects the document's first `length` characters, by keyboard.
 *
 * NOT `dblclick` on the word: Playwright clicks a locator's CENTRE, and the
 * centre of a line element is wherever it happens to be — for this document
 * it landed on a space, which the model then correctly refused to highlight.
 * That looked exactly like a broken feature and was a broken test. Keyboard
 * selection is deterministic about which characters end up selected.
 */
async function selectFirst(page: Page, length: number): Promise<void> {
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+Home')
  for (let i = 0; i < length; i += 1) await page.keyboard.press('Shift+ArrowRight')
  await page.waitForTimeout(200)
}

async function openPanel(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: /Show highlights/ }).click()
  await expect(page.getByRole('complementary', { name: 'Highlights' })).toBeVisible()
}

const toolbar = (page: Page) => page.getByRole('dialog', { name: 'Highlight selection' })

test('selecting text offers the toolbar; picking a colour paints a highlight', async ({ page }) => {
  await openApp(page)
  await setDoc(page, 'The quick brown fox jumps over the lazy dog.')

  await expect(toolbar(page)).toBeHidden()
  await selectFirst(page, 9)
  await expect(toolbar(page)).toBeVisible()

  await toolbar(page).getByRole('button', { name: 'Amber' }).click()

  const painted = page.locator('.cm-content .cm-highlight')
  await expect(painted.first()).toBeVisible()
  await expect(painted.first()).toHaveText('The quick')
  // The toolbar goes away once the highlight exists.
  await expect(toolbar(page)).toBeHidden()
})

test('the panel lists the highlight and counts it', async ({ page }) => {
  await openApp(page)
  await setDoc(page, 'The quick brown fox jumps over the lazy dog.')
  await openPanel(page)

  await selectFirst(page, 9)
  await toolbar(page).getByRole('button', { name: 'Green' }).click()

  const panel = page.getByRole('complementary', { name: 'Highlights' })
  await expect(panel.getByRole('button', { name: /Highlight: The quick/ })).toBeVisible()
  await expect(panel.getByRole('heading', { name: 'Highlights' })).toBeVisible()
})

test('a note typed in the toolbar is saved with the highlight', async ({ page }) => {
  await openApp(page)
  await setDoc(page, 'The quick brown fox jumps over the lazy dog.')
  await openPanel(page)

  await selectFirst(page, 9)
  await toolbar(page).getByRole('button', { name: 'Add a note' }).click()
  await toolbar(page).getByRole('textbox', { name: 'Highlight note' }).fill('Check this word')
  await page.keyboard.press('ControlOrMeta+Enter')

  await expect(page.getByText('Check this word')).toBeVisible()
})

test('highlights survive a reload — they really reached the database', async ({ page }) => {
  await openApp(page)
  await setDoc(page, 'The quick brown fox jumps over the lazy dog.')
  await openPanel(page)

  await selectFirst(page, 9)
  await toolbar(page).getByRole('button', { name: 'Amber' }).click()
  await expect(page.locator('.cm-content .cm-highlight')).toHaveCount(1)
  // Give the write a moment to land before pulling the page out from under it.
  await page.waitForTimeout(500)

  await page.reload()
  await page.locator('.cm-content').waitFor()

  await expect(page.locator('.cm-content .cm-highlight')).toHaveCount(1)
  await expect(page.locator('.cm-content .cm-highlight').first()).toHaveText('The quick')
})

test('a highlight follows the text when earlier text is edited', async ({ page }) => {
  await openApp(page)
  await setDoc(page, 'The quick brown fox jumps over the lazy dog.')

  await selectFirst(page, 9)
  await toolbar(page).getByRole('button', { name: 'Amber' }).click()
  await expect(page.locator('.cm-content .cm-highlight')).toHaveText('The quick')

  // Type at the very start: every offset after it shifts. The highlight must
  // still cover the same WORD, not the same offsets.
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.type('Once upon a time. ')
  await page.waitForTimeout(300)

  await expect(page.locator('.cm-content .cm-highlight')).toHaveText('The quick')
})

test('removing a highlight from the panel unpaints it', async ({ page }) => {
  await openApp(page)
  await setDoc(page, 'The quick brown fox jumps over the lazy dog.')
  await openPanel(page)

  await selectFirst(page, 9)
  await toolbar(page).getByRole('button', { name: 'Amber' }).click()
  await expect(page.locator('.cm-content .cm-highlight')).toHaveCount(1)

  await page
    .getByRole('complementary', { name: 'Highlights' })
    .getByRole('button', { name: 'Remove highlight' })
    .click()

  await expect(page.locator('.cm-content .cm-highlight')).toHaveCount(0)
})

test('deleting the highlighted text removes the highlight', async ({ page }) => {
  await openApp(page)
  await setDoc(page, 'The quick brown fox jumps over the lazy dog.')
  await openPanel(page)

  await selectFirst(page, 9)
  await toolbar(page).getByRole('button', { name: 'Amber' }).click()
  await expect(page.locator('.cm-content .cm-highlight')).toHaveCount(1)

  // Select the word again and type over it: nothing of the original span
  // survives, so the highlight has nothing left to colour.
  await selectFirst(page, 9)
  await page.keyboard.type('red')
  await page.waitForTimeout(300)

  await expect(page.locator('.cm-content .cm-highlight')).toHaveCount(0)
  await expect(
    page.getByRole('complementary', { name: 'Highlights' }).getByText('No highlights yet.'),
  ).toBeVisible()
})

import { test, expect, type Page } from '@playwright/test'

/**
 * Real keyboard input throughout (`page.keyboard.type`/`.press`) for the
 * actual Tab/Shift-Tab presses under test — same reasoning as
 * `word-completion.spec.ts`'s own doc comment: `.cm-content` only reacts to
 * genuine key events, and the `listIndentKeymap` extension under test here
 * only ever fires for real ones.
 *
 * Multi-line SEEDING (setting up a starting document) goes through
 * `page.keyboard.insertText` instead, never `.type()` line by line — typing
 * a literal `\n` inside a `.type()` string sends a real Enter keydown,
 * which `@codemirror/lang-markdown`'s own `markdownKeymap` binds to
 * `insertNewlineContinueMarkup` (see `useCodeMirror.ts`'s `createState`),
 * auto-inserting a fresh list marker on the new line — exactly what
 * corrupted `task-list-checkbox.spec.ts`'s own seeding before it switched
 * to `insertText` (see that file's `setEditorContent` doc comment). Only
 * the MOTIVATING-CASE test below deliberately types a real Enter (that IS
 * the behaviour it's proving Tab composes with).
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

function tooltip(page: Page) {
  return page.locator('.cm-tooltip-autocomplete')
}

/** The full document text, one string per source line joined by `\n` — see
 * `task-list-checkbox.spec.ts`'s own `getEditorLines` for why this reads
 * each `.cm-line` individually rather than `.cm-content`'s own
 * `textContent` (which collapses every line together with no separator).
 * Used through `expect.poll` so a multi-line assertion retries the same way
 * a single-line `toHaveText` already does. */
function getEditorLines(page: Page): Promise<string> {
  return page
    .locator('.cm-content .cm-line')
    .allTextContents()
    .then((lines) => lines.join('\n'))
}

/** Opens Settings and turns "Word completion" on — copied from
 * `word-completion.spec.ts`'s own helper of the same name, needed here only
 * for the one test that proves Tab still accepts an open completion menu
 * ahead of indenting a list item. */
async function setWordCompletionSetting(page: Page, enabled: boolean): Promise<void> {
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Settings' }).click()
  const checkbox = page.getByRole('checkbox', { name: 'Word completion' })
  await checkbox.waitFor()
  const isChecked = await checkbox.isChecked()
  if (isChecked !== enabled) {
    await checkbox.click()
  }
  await page.getByRole('button', { name: 'Close settings' }).click()
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden()
}

test.describe('list indent / outdent (Tab / Shift-Tab)', () => {
  test('the motivating case: Enter after a list item, then Tab nests the new item, then Shift-Tab returns it', async ({
    page,
  }) => {
    await openApp(page)
    await clearEditor(page)

    await page.keyboard.type('- one')
    // A real Enter — `markdownKeymap`'s `insertNewlineContinueMarkup` auto-
    // continues the list, giving a fresh "- " on the new line.
    await page.keyboard.press('Enter')
    await page.keyboard.type('two')
    await expect.poll(() => getEditorLines(page)).toBe('- one\n- two')

    await page.keyboard.press('Tab')
    await expect.poll(() => getEditorLines(page)).toBe('- one\n  - two')
    // Tab was consumed by the list-indent command, not the browser's native
    // "move focus off the editor" fallback.
    await expect(page.locator('.cm-content')).toBeFocused()

    await page.keyboard.press('Shift+Tab')
    await expect.poll(() => getEditorLines(page)).toBe('- one\n- two')
    await expect(page.locator('.cm-content')).toBeFocused()
  })

  test('Tab accepts an open completion menu rather than indenting the list item it is on', async ({
    page,
  }) => {
    await openApp(page)
    await setWordCompletionSetting(page, true)
    await clearEditor(page)

    await page.keyboard.type('- widget widg')
    await expect(tooltip(page)).toBeVisible()
    // `acceptCompletion` refuses within `interactionDelay` (75ms) of the
    // menu opening — see `word-completion.spec.ts`'s own test for why this
    // waits it out rather than relying on incidental round-trip latency.
    await page.waitForTimeout(100)

    await page.keyboard.press('Tab')
    await expect(tooltip(page)).toBeHidden()
    // Completed the word ("widg" -> "widget"); did NOT also indent the line
    // it sits on (no leading spaces added).
    await expect.poll(() => getEditorLines(page)).toBe('- widget widget')
  })

  test('Tab on a line that is not a list item still falls through to the native "move focus" default', async ({
    page,
  }) => {
    await openApp(page)
    await clearEditor(page)

    await page.keyboard.type('just a paragraph')
    await expect(page.locator('.cm-content')).toBeFocused()

    await page.keyboard.press('Tab')
    await expect(page.locator('.cm-content')).not.toBeFocused()
    await expect.poll(() => getEditorLines(page)).toBe('just a paragraph')
  })

  test('Tab inside a fenced code block is never treated as a list indent, even on a "- " line', async ({
    page,
  }) => {
    await openApp(page)
    await clearEditor(page)
    await page.keyboard.insertText('```\n- looks like a list\n```')

    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+Home')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('End')

    await page.keyboard.press('Tab')
    // Refused by the list-indent command (inside a fence) and by
    // completion (nothing open) alike, so it falls through to native
    // behaviour — focus leaves the editor, and the fenced text is
    // untouched.
    await expect(page.locator('.cm-content')).not.toBeFocused()
    await expect.poll(() => getEditorLines(page)).toBe('```\n- looks like a list\n```')
  })

  test('undo restores the pre-indent text in one step', async ({ page }) => {
    await openApp(page)
    await clearEditor(page)
    await page.keyboard.insertText('- one\n- two')

    await page.keyboard.press('Tab')
    await expect.poll(() => getEditorLines(page)).toBe('- one\n  - two')

    await page.keyboard.press('Control+z')
    await expect.poll(() => getEditorLines(page)).toBe('- one\n- two')
  })

  test('indenting keeps the cursor with its own text rather than dragging it to the line edge', async ({
    page,
  }) => {
    await openApp(page)
    await clearEditor(page)
    // `insertText` leaves the cursor at the very end of the inserted text —
    // right after "two".
    await page.keyboard.insertText('- one\n- two')

    await page.keyboard.press('Tab')
    await expect.poll(() => getEditorLines(page)).toBe('- one\n  - two')

    // If the cursor were still sitting right after "two" (not dragged to
    // the start of the now-indented line), typing here lands it there too.
    await page.keyboard.type('X')
    await expect.poll(() => getEditorLines(page)).toBe('- one\n  - twoX')
  })
})

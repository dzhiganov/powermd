import { test, expect, type Page } from '@playwright/test'

/**
 * The browser's spell checker is switched off over code
 * (`features/editor/lib/codeSpellcheck.ts`).
 *
 * WHAT THIS CAN AND CANNOT SHOW. Spell-check squiggles are painted by the
 * browser itself and never appear in the DOM, so no automated check can
 * assert "there is no red underline here" — and headless Chromium ships no
 * dictionary, so it draws none regardless. What these tests pin down is the
 * part this codebase actually controls: that `spellcheck="false"` lands on
 * exactly the code ranges and on nothing else. The browser honouring that
 * attribute on a descendant of a contenteditable is standard behaviour, and
 * was confirmed by eye in a real browser separately.
 */

async function openApp(page: Page): Promise<void> {
  await page.goto('/')
  await page.locator('.cm-content').waitFor()
}

async function setDoc(page: Page, text: string): Promise<void> {
  await page.locator('.cm-content').fill(text)
  // Let the markdown parse settle so the decorations reflect the new text.
  await page.waitForTimeout(400)
}

/** The text of every element carrying `spellcheck="false"` inside the
 * editor, joined — i.e. everything the browser has been told to skip. */
async function unchecked(page: Page): Promise<string> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.cm-content [spellcheck="false"]'))
      .map((el) => el.textContent ?? '')
      .join('\n'),
  )
}

test('a fenced block is excluded, the prose around it is not', async ({ page }) => {
  await openApp(page)
  await setDoc(
    page,
    'Some prose here.\n\n```js\nawait api.createOrder(payload)\n```\n\nMore prose.',
  )

  const skipped = await unchecked(page)
  expect(skipped).toContain('createOrder')
  expect(skipped).toContain('payload')
  // The fence line itself is not prose either.
  expect(skipped).toContain('```js')

  // Prose is still checked — this feature must not quietly disable spell
  // checking for the whole document.
  expect(skipped).not.toContain('Some prose here.')
  expect(skipped).not.toContain('More prose.')
})

test('the content element itself still has spell check on', async ({ page }) => {
  await openApp(page)
  await setDoc(page, '```js\nconst x = 1\n```')

  // The exclusion is an override on descendants, not a document-wide
  // switch-off — otherwise prose would silently stop being checked.
  await expect(page.locator('.cm-content')).toHaveAttribute('spellcheck', 'true')
})

test('inline code is excluded too', async ({ page }) => {
  await openApp(page)
  await setDoc(page, 'Call `createOrder` before `flushQueue` to be safe.')

  const skipped = await unchecked(page)
  expect(skipped).toContain('createOrder')
  expect(skipped).toContain('flushQueue')
  expect(skipped).not.toContain('before')
})

test('an indented code block is excluded', async ({ page }) => {
  await openApp(page)
  await setDoc(page, 'Prose paragraph.\n\n    const unspellable = 1\n')

  expect(await unchecked(page)).toContain('unspellable')
})

test('the exclusion follows an edit', async ({ page }) => {
  await openApp(page)
  await setDoc(page, 'Just prose, no code at all.')
  expect(await unchecked(page)).toBe('')

  // Typing a block should start excluding it, not wait for a reload.
  await setDoc(page, '```\nnewlyTypedIdentifier\n```')
  expect(await unchecked(page)).toContain('newlyTypedIdentifier')
})

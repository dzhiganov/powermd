import { test, expect, type Page } from '@playwright/test'

/**
 * Typing ``` opens a fenced code block and writes the closing fence for you
 * (`features/editor/lib/codeFence.ts`).
 *
 * When it fires and why is unit-tested in `codeFence.test.ts` against a pure
 * function. What only a real editor can show is the rest: that a genuine
 * keystroke reaches the input handler at all, where the cursor actually ends
 * up afterwards, that one undo takes the whole thing back out, and — the
 * case with the most ways to go wrong — that closing a block by hand still
 * works, which depends on a live syntax tree rather than on any string the
 * unit tests can hand in.
 */

async function openApp(page: Page): Promise<void> {
  await page.goto('/')
  await page.locator('.cm-content').waitFor()
}

/** Clears the document and leaves the cursor in an empty editor. */
async function startEmpty(page: Page): Promise<void> {
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
}

function docText(page: Page): Promise<string> {
  // `.cm-content`'s innerText collapses CodeMirror's per-line divs into
  // newlines, which is what we want to assert on.
  return page.locator('.cm-content').innerText()
}

test('typing ``` writes the closing fence and leaves the cursor on the opening one', async ({
  page,
}) => {
  await openApp(page)
  await startEmpty(page)
  await page.keyboard.type('```')

  expect((await docText(page)).trim()).toBe('```\n```')

  // The cursor sits at the end of the OPENING fence, so a language can be
  // typed straight away — this is the whole reason it isn't parked on a
  // blank line between the two.
  await page.keyboard.type('ts')
  expect((await docText(page)).trim()).toBe('```ts\n```')
})

test('one Enter opens the body between the fences', async ({ page }) => {
  await openApp(page)
  await startEmpty(page)
  await page.keyboard.type('```js')
  await page.keyboard.press('Enter')
  await page.keyboard.type('const x = 1')

  expect((await docText(page)).trim()).toBe('```js\nconst x = 1\n```')
})

test('a single undo removes the whole block, leaving earlier text intact', async ({ page }) => {
  await openApp(page)
  await startEmpty(page)
  await page.keyboard.type('hello')
  // Past CodeMirror's history grouping window (500ms), so the fence below
  // starts its own undo entry instead of merging with the line above.
  // Without this the assertion would say nothing about the fence: one undo
  // would revert the typing too, simply because it was all one burst.
  await page.waitForTimeout(700)

  await page.keyboard.press('Enter')
  await page.keyboard.type('```')
  expect((await docText(page)).trim()).toBe('hello\n```\n```')

  await page.keyboard.press('ControlOrMeta+z')

  // The auto-inserted closing fence is undone together with the backticks
  // that triggered it — one undo for something the user did once — and it
  // stops there rather than eating the line before it.
  expect((await docText(page)).trim()).toBe('hello')
})

test('closing a block by hand does not add a second fence', async ({ page }) => {
  await openApp(page)
  await startEmpty(page)
  // Build an OPEN block without triggering the completion: the fence is
  // typed as two backticks plus one inserted separately, so the handler
  // never sees a third backtick land on an empty line.
  await page.locator('.cm-content').fill('```js\nconst x = 1\n')
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('```')

  // Exactly one closing fence. Auto-closing here would have produced a
  // second one and stranded the first.
  expect((await docText(page)).trim()).toBe('```js\nconst x = 1\n```')
})

test('three backticks mid-sentence stay literal text', async ({ page }) => {
  await openApp(page)
  await startEmpty(page)
  await page.keyboard.type('see ```')

  expect((await docText(page)).trim()).toBe('see ```')
})

test('inline code is untouched', async ({ page }) => {
  await openApp(page)
  await startEmpty(page)
  await page.keyboard.type('`code`')

  expect((await docText(page)).trim()).toBe('`code`')
})

test('the completed block renders as a code block in the preview', async ({ page }) => {
  await openApp(page)
  await startEmpty(page)
  await page.keyboard.type('```js')
  await page.keyboard.press('Enter')
  await page.keyboard.type('const x = 1')

  // The point of the feature: what it writes is a fence the markdown
  // pipeline actually recognises, not just text that looks like one.
  await expect(page.locator('.markdown-preview pre code')).toContainText('const x = 1')
})

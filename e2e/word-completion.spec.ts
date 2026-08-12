import { test, expect, type Page } from '@playwright/test'

/**
 * Real keyboard input throughout (`page.keyboard.type`/`.press`), same
 * reasoning as `wiki-link-completion.spec.ts`'s own doc comment: `.cm-content`
 * only reacts to genuine input events, and only real events reach the
 * `wordCompletion.ts` extension under test here.
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

function options(page: Page) {
  return page.locator('.cm-tooltip-autocomplete ul li')
}

async function renameActiveDocument(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Rename document' }).click()
  const input = page.getByRole('textbox', { name: 'Document title' })
  await input.fill(title)
  await input.press('Enter')
}

async function createDocument(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'New file' }).click()
  await renameActiveDocument(page, title)
}

function documentsPanel(page: Page) {
  return page.locator('aside[aria-label="Documents"]')
}

async function selectDocument(page: Page, title: string): Promise<void> {
  await documentsPanel(page).getByRole('button', { name: title, exact: true }).click()
}

/** Opens Settings (defaults to the Editor category, where the "Word
 * completion" toggle lives) and sets it to the given on/off state,
 * idempotently — reads the checkbox's own state first rather than always
 * clicking, so calling this twice in a row with the same value is a no-op
 * rather than toggling back off. */
async function setWordCompletionSetting(page: Page, enabled: boolean): Promise<void> {
  // Settings lives behind the header's "More actions" popover -> "Settings"
  // menu item (`MoreMenu.vue`) — `SettingsButton.vue` exists but isn't
  // mounted anywhere in the current app shell.
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

test.describe('in-document word completion', () => {
  test('the setting is off by default — no menu even for a repeated word', async ({ page }) => {
    await openApp(page)
    await clearEditor(page)

    await page.keyboard.type('widget widget wid')
    await expect(tooltip(page)).toBeHidden()
  })

  test('opens after the minimum prefix, filters as more is typed, excludes the in-progress word, and inserts on accept', async ({
    page,
  }) => {
    await openApp(page)
    await setWordCompletionSetting(page, true)
    await clearEditor(page)

    await page.keyboard.type('widget widen')
    // "widen" is still on-screen mid-typing — no completion has been
    // accepted, so re-typing "wid" below must not find a second copy of it.
    await expect(tooltip(page)).toBeHidden()

    await page.keyboard.type(' wi')
    // Two characters: below the 3-character minimum prefix.
    await expect(tooltip(page)).toBeHidden()

    await page.keyboard.type('d')
    // Three characters: menu opens, offering both earlier words. Neither
    // "widget" nor "widen" is complete enough to equal the in-progress
    // "wid" itself, so nothing is excluded as a no-op match here.
    await expect(tooltip(page)).toBeVisible()
    await expect(options(page)).toHaveCount(2)
    await expect(options(page).filter({ hasText: 'widget' })).toBeVisible()
    await expect(options(page).filter({ hasText: 'widen' })).toBeVisible()

    await page.keyboard.type('g')
    // "widg" narrows to just "widget".
    await expect(options(page)).toHaveCount(1)
    await expect(options(page).first()).toHaveText('widget')

    await page.keyboard.press('Enter')
    await expect(tooltip(page)).toBeHidden()
    await expect(page.locator('.cm-content')).toHaveText('widget widen widget')
  })

  test('Escape dismisses the menu without inserting anything', async ({ page }) => {
    await openApp(page)
    await setWordCompletionSetting(page, true)
    await clearEditor(page)

    await page.keyboard.type('banana ban')
    await expect(tooltip(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(tooltip(page)).toBeHidden()
    await expect(page.locator('.cm-content')).toHaveText('banana ban')
  })

  test("matches case-insensitively while preserving the suggested word's original casing", async ({
    page,
  }) => {
    await openApp(page)
    await setWordCompletionSetting(page, true)
    await clearEditor(page)

    await page.keyboard.type('JavaScript is great. jav')
    await expect(tooltip(page)).toBeVisible()
    await expect(options(page)).toHaveCount(1)
    await expect(options(page).first()).toHaveText('JavaScript')
  })

  test('a word that has already been typed in full does not suggest itself', async ({ page }) => {
    await openApp(page)
    await setWordCompletionSetting(page, true)
    await clearEditor(page)

    await page.keyboard.type('marker')
    // The word just finished is the only thing in the document — nothing
    // else to complete it with, and its own occurrence is excluded.
    await expect(tooltip(page)).toBeHidden()
  })

  test('turning the setting off suppresses the menu entirely', async ({ page }) => {
    await openApp(page)
    await setWordCompletionSetting(page, true)
    await clearEditor(page)
    await page.keyboard.type('widget wid')
    await expect(tooltip(page)).toBeVisible()
    await page.keyboard.press('Escape')

    await setWordCompletionSetting(page, false)
    await clearEditor(page)
    await page.keyboard.type('widget wid')
    await expect(tooltip(page)).toBeHidden()
  })

  test('never triggers inside a fenced code block or inline code', async ({ page }) => {
    await openApp(page)
    await setWordCompletionSetting(page, true)
    await clearEditor(page)

    await page.keyboard.type('widget\n\n```\nwidget widget widget\n```')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('End')
    await page.keyboard.type(' wid')
    await expect(tooltip(page)).toBeHidden()

    await clearEditor(page)
    // Build a COMPLETE, closed inline-code span first, then reposition the
    // cursor inside it and type from there — typing while the span is still
    // open (no closing backtick yet) wouldn't be a meaningful test of code
    // exclusion, since the syntax tree can't know it's code yet either (same
    // reasoning as `wiki-link-completion.spec.ts`'s own inline-code case).
    await page.keyboard.type('widget widget widget `xyz`')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.type('wid')
    await expect(tooltip(page)).toBeHidden()
  })

  test('`[[` opens the wiki-link menu, never the word menu, even when both patterns would match', async ({
    page,
  }) => {
    await openApp(page)
    await setWordCompletionSetting(page, true)
    await renameActiveDocument(page, 'Current Doc')
    // A second document whose title could ALSO look like a word-completion
    // candidate — `createDocument` switches to it, so switch back to the one
    // actually being edited before typing.
    await createDocument(page, 'Widget Notes')
    await selectDocument(page, 'Current Doc')
    await clearEditor(page)

    await page.keyboard.type('widget prose text. ')
    await page.keyboard.type('[[wid')
    // Only the wiki-link menu appears — its one option is the OTHER
    // document's title, never the bare word "widget" from this document's
    // own prose.
    await expect(tooltip(page)).toBeVisible()
    await expect(options(page)).toHaveCount(1)
    await expect(options(page).first()).toHaveText('Widget Notes')

    await page.keyboard.press('Escape')
    await expect(tooltip(page)).toBeHidden()

    // Once the link is closed off, word completion resumes normally.
    await page.keyboard.type(']] wid')
    await expect(tooltip(page)).toBeVisible()
    await expect(options(page).filter({ hasText: 'widget' })).toBeVisible()
  })
})

test.describe('in-document word completion — performance on a large document', () => {
  test('keystroke latency stays low while a completion menu is open in a 5,000+ word document', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openApp(page)
    await setWordCompletionSetting(page, true)
    await clearEditor(page)

    // 5,500 words drawn from a small vocabulary (so words repeat, exercising
    // the frequency-ranking path too), pasted in one shot rather than typed
    // — seeding the fixture is not what this test measures.
    const vocabulary = Array.from({ length: 60 }, (_, i) => `lorexicon${i}`)
    const words = Array.from({ length: 5500 }, (_, i) => vocabulary[i % vocabulary.length])
    const largeDocument = words.join(' ')

    await page.evaluate(async (text) => {
      await navigator.clipboard.writeText(text)
    }, largeDocument)
    await page.keyboard.press('Control+v')

    await expect(page.getByText(/5,500 words/)).toBeVisible()

    await page.keyboard.press('Control+End')
    await page.keyboard.type(' ')

    // Type "lorexicon" one character at a time — well past the 3-character
    // minimum, so the completion menu is open (and being re-filtered) for
    // most of these keystrokes. Deliberately a PROPER PREFIX of every
    // vocabulary word ("lorexicon0".."lorexicon59"), never a complete word
    // itself, so the menu stays open (and non-empty) through the very last
    // keystroke rather than emptying out via the exact-match exclusion (see
    // `filterWordCompletions`'s doc comment) the moment a full word is
    // typed. Each `press` is timed individually via a real round trip (CDP
    // dispatch + the extension's own work), the same latency the user
    // actually experiences per keystroke.
    const target = 'lorexicon'
    const perKeystrokeMs: number[] = []
    for (const char of target) {
      const start = Date.now()
      await page.keyboard.press(char)
      perKeystrokeMs.push(Date.now() - start)
    }
    await expect(tooltip(page)).toBeVisible()

    const totalMs = perKeystrokeMs.reduce((a, b) => a + b, 0)
    const averageMs = totalMs / perKeystrokeMs.length
    const maxMs = Math.max(...perKeystrokeMs)
    console.log(
      `[word-completion perf] 5,500-word document — per-keystroke: ${perKeystrokeMs
        .map((ms) => `${ms}ms`)
        .join(', ')} | average ${averageMs.toFixed(1)}ms | max ${maxMs}ms`,
    )

    // A generous ceiling (not a tight performance budget) — this exists to
    // catch a genuine O(document length) regression per keystroke (which
    // would show up as hundreds of ms, not tens), not to assert a specific
    // number. See the task report for the actual measured figures.
    expect(averageMs).toBeLessThan(150)
  })
})

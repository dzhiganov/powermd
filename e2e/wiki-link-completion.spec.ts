import { test, expect, type Page } from '@playwright/test'

/**
 * Real keyboard input throughout (`page.keyboard.type`/`.press`), never a
 * synthetic value assignment — see `typing.spec.ts`'s own doc comment for
 * why: `.cm-content` is CodeMirror's `contentEditable` surface, and only
 * genuine `keydown`/`keypress`/`input`/`keyup` sequences reach its own
 * extensions (the completion source under test here included).
 *
 * Documents are seeded through the app's own UI (the "New file" button and
 * the title-rename affordances in `DocumentTitle.vue`/`DocumentRow.vue`),
 * not by writing to IndexedDB/localStorage directly — the completion
 * source reads the live `$documentList`/`$activeId` mirrors fed by
 * `src/app/wiring.ts`, which only ever change in response to the real
 * `documents` feature events those UI actions fire. Driving the same UI a
 * user would is what proves the *whole* wire — model, wiring, and
 * CodeMirror extension — actually works end to end, not just the
 * completion source in isolation (that's what
 * `src/features/editor/lib/wikiLinkCompletion.test.ts` already covers).
 */

async function openApp(page: Page): Promise<void> {
  await page.goto('/')
  await page.locator('.cm-content').waitFor()
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

/** Clicks a document row by its exact title — only valid for a document
 * that is *not* currently active (an active row's title click renames it
 * instead, see `DocumentRow.vue`'s `handleTitleClick`). */
async function selectDocument(page: Page, title: string): Promise<void> {
  await documentsPanel(page).getByRole('button', { name: title, exact: true }).click()
}

/** Renames a document that is *not* currently active, via its row's "⋯"
 * actions menu — the header rename affordance (`renameActiveDocument`)
 * only ever reaches the active document. Used to prove the completion
 * source reflects a rename made to a document other than the one being
 * edited, without ever reloading the page. */
async function renameDocumentByRow(page: Page, oldTitle: string, newTitle: string): Promise<void> {
  const aside = documentsPanel(page)
  await aside.getByRole('button', { name: `Actions for ${oldTitle}` }).click()
  await aside.getByRole('menuitem', { name: 'Rename' }).click()
  const input = aside.getByRole('textbox', { name: 'Document title' })
  await input.fill(newTitle)
  await input.press('Enter')
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

test.describe('wiki-link inline autocomplete', () => {
  test('shows no menu when the current document is the only one', async ({ page }) => {
    await openApp(page)
    await renameActiveDocument(page, 'Solo Doc')
    await clearEditor(page)

    await page.keyboard.type('[[')

    // No other document exists — a document can never suggest itself, so
    // there is nothing to offer.
    await expect(tooltip(page)).toBeHidden()
  })

  test('opens on `[[`, filters as more is typed, and excludes the current document', async ({
    page,
  }) => {
    await openApp(page)
    await renameActiveDocument(page, 'Current Doc')
    await createDocument(page, 'Bravo Notes')
    await createDocument(page, 'Charlie Plan')

    await selectDocument(page, 'Current Doc')
    await clearEditor(page)

    await page.keyboard.type('[[')
    await expect(tooltip(page)).toBeVisible()
    await expect(options(page)).toHaveCount(2)
    await expect(options(page).filter({ hasText: 'Bravo Notes' })).toBeVisible()
    await expect(options(page).filter({ hasText: 'Charlie Plan' })).toBeVisible()
    await expect(options(page).filter({ hasText: 'Current Doc' })).toHaveCount(0)

    await page.keyboard.type('Bra')
    await expect(options(page)).toHaveCount(1)
    await expect(options(page).first()).toHaveText('Bravo Notes')
  })

  test('accepting inserts the full [[Title]] marker with the cursor after it, and renders resolved in the preview', async ({
    page,
  }) => {
    await openApp(page)
    await renameActiveDocument(page, 'Current Doc B')
    await createDocument(page, 'Bravo Notes')

    await selectDocument(page, 'Current Doc B')
    await clearEditor(page)

    await page.keyboard.type('[[Bra')
    await expect(options(page)).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect(tooltip(page)).toBeHidden()

    // The cursor lands right after the closing `]]` — typing more text
    // continues after the marker, not inside it.
    await page.keyboard.type('END')
    await expect(page.locator('.cm-content')).toHaveText('[[Bravo Notes]]END')

    const previewLink = page.locator('.markdown-preview a.wiki-link--resolved', {
      hasText: 'Bravo Notes',
    })
    await expect(previewLink).toBeVisible()
  })

  test('Tab accepts the highlighted suggestion, same as Enter', async ({ page }) => {
    await openApp(page)
    await renameActiveDocument(page, 'Current Doc Tab')
    await createDocument(page, 'Bravo Notes')

    await selectDocument(page, 'Current Doc Tab')
    await clearEditor(page)

    await page.keyboard.type('[[Bra')
    await expect(options(page)).toHaveCount(1)
    // Same `interactionDelay` (75ms, `@codemirror/autocomplete`'s own
    // accept guard) wait as `word-completion.spec.ts`'s Tab-accepts test —
    // see that test's comment for the full reasoning.
    await page.waitForTimeout(100)
    await page.keyboard.press('Tab')
    await expect(tooltip(page)).toBeHidden()

    // Same "cursor lands right after the closing ]]" check as the Enter
    // variant of this test above.
    await page.keyboard.type('END')
    await expect(page.locator('.cm-content')).toHaveText('[[Bravo Notes]]END')
  })

  test('Escape dismisses the menu without inserting anything', async ({ page }) => {
    await openApp(page)
    await renameActiveDocument(page, 'Current Doc C')
    await createDocument(page, 'Bravo Notes')

    await selectDocument(page, 'Current Doc C')
    await clearEditor(page)

    await page.keyboard.type('[[')
    await expect(tooltip(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(tooltip(page)).toBeHidden()

    await expect(page.locator('.cm-content')).toHaveText('[[')
  })

  test('has no options for a query that matches no title', async ({ page }) => {
    await openApp(page)
    await renameActiveDocument(page, 'Current Doc D')
    await createDocument(page, 'Something')

    await selectDocument(page, 'Current Doc D')
    await clearEditor(page)

    await page.keyboard.type('[[zzz-does-not-exist')
    await expect(tooltip(page)).toBeHidden()
  })

  test('reflects a title renamed elsewhere while the editor stays open — no reload', async ({
    page,
  }) => {
    await openApp(page)
    await renameActiveDocument(page, 'Current Doc E')
    await createDocument(page, 'Original Title')

    await selectDocument(page, 'Current Doc E')
    await clearEditor(page)

    await page.keyboard.type('[[Orig')
    await expect(options(page).filter({ hasText: 'Original Title' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(tooltip(page)).toBeHidden()

    // Rename the *other* document (not the one being edited) via its row
    // menu — the editor's `EditorView` is never rebuilt or reloaded by this.
    await renameDocumentByRow(page, 'Original Title', 'Renamed Title')

    await clearEditor(page)
    await page.keyboard.type('[[Renamed')
    await expect(options(page).filter({ hasText: 'Renamed Title' })).toBeVisible()

    await clearEditor(page)
    await page.keyboard.type('[[Orig')
    await expect(tooltip(page)).toBeHidden()
  })

  test('reflects a document created while the editor stays open — no reload', async ({ page }) => {
    await openApp(page)
    await renameActiveDocument(page, 'Current Doc F')
    await clearEditor(page)

    await page.keyboard.type('[[')
    await expect(tooltip(page)).toBeHidden()

    // Creating a document switches the active document to it — switch back
    // to the document under test before re-triggering the menu.
    await createDocument(page, 'Fresh Doc')
    await selectDocument(page, 'Current Doc F')
    await clearEditor(page)

    await page.keyboard.type('[[')
    await expect(options(page).filter({ hasText: 'Fresh Doc' })).toBeVisible()
  })

  test('an HTML-bearing title renders as inert text, never as markup', async ({ page }) => {
    await openApp(page)
    await renameActiveDocument(page, 'Current Doc G')
    const trap = '<img src=x onerror=alert(1)>'
    await createDocument(page, trap)

    await selectDocument(page, 'Current Doc G')
    await clearEditor(page)

    await page.keyboard.type('[[')
    const label = page.locator('.cm-tooltip-autocomplete .cm-completionLabel').first()
    await expect(label).toHaveText(trap)
    // The raw string was never parsed as HTML: no <img> element exists
    // anywhere inside the tooltip's DOM.
    await expect(page.locator('.cm-tooltip-autocomplete img')).toHaveCount(0)
  })

  test('never triggers inside a fenced code block or inline code', async ({ page }) => {
    await openApp(page)
    await renameActiveDocument(page, 'Current Doc H')
    await createDocument(page, 'Should Never Appear')

    await selectDocument(page, 'Current Doc H')
    await clearEditor(page)

    // Build a complete fenced block first, then move the cursor back inside
    // it before typing `[[` — typing it *while* the fence is still open
    // (before the closing ``` exists) wouldn't be a meaningful test of code
    // exclusion, since the syntax tree can't know it's code yet either.
    await page.keyboard.type('```\ncode\n```')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('End')
    await page.keyboard.type('[[')
    await expect(tooltip(page)).toBeHidden()

    await clearEditor(page)

    // Same reasoning for inline code: build the complete `` `text` `` span
    // first, then reposition the cursor inside it.
    await page.keyboard.type('`code`')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.type('[[')
    await expect(tooltip(page)).toBeHidden()
  })
})

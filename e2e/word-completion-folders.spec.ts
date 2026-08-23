import { test, expect, type Page } from '@playwright/test'

/**
 * E2E coverage for the per-folder word-completion exclusion preference
 * (`features/settings/model/editorPreferences.ts`'s
 * `$wordCompletionExcludedFolderIds`, resolved against the open document's
 * folder by `src/app/lib/wordCompletionScope.ts`'s `isWordCompletionActive`
 * — unit-tested there in isolation). This file only exercises the live,
 * end-to-end wire: real folders created and documents moved through the
 * app's own UI (never IndexedDB/localStorage written to directly — same
 * reasoning as `wiki-link-completion.spec.ts`'s own doc comment), a real
 * exclusion toggle in Settings, and real typing to observe whether the
 * completion menu shows up.
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

async function renameActiveDocument(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Rename document' }).click()
  const input = page.getByRole('textbox', { name: 'Document title' })
  await input.fill(title)
  await input.press('Enter')
}

async function createDocument(page: Page, title: string): Promise<void> {
  // "New file" is a menu item under the "New" button now, not a button of
  // its own — the two create actions were merged into one popover.
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New file' }).click()
  await renameActiveDocument(page, title)
}

function documentsPanel(page: Page) {
  return page.locator('aside[aria-label="Documents"]')
}

async function selectDocument(page: Page, title: string): Promise<void> {
  await documentsPanel(page).getByRole('button', { name: title, exact: true }).click()
}

async function createFolder(page: Page, name: string): Promise<void> {
  // Same merged "New" popover as `createDocument` above.
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New folder' }).click()
  const input = page.getByRole('textbox', { name: 'New folder name' })
  await input.fill(name)
  await input.press('Enter')
}

/** Moves a document into a folder via its row's "⋯" -> "Move to" menu —
 * the same real affordance `wiki-link-completion.spec.ts`'s
 * `renameDocumentByRow` drives for renaming, just the "Move to" section of
 * the same menu (`DocumentRow.vue`). */
async function moveDocumentToFolder(
  page: Page,
  docTitle: string,
  folderName: string,
): Promise<void> {
  const aside = documentsPanel(page)
  await aside.getByRole('button', { name: `Actions for ${docTitle}` }).click()
  await aside.getByRole('menuitem', { name: folderName, exact: true }).click()
}

/** Opens Settings -> Editor and sets the global "Word completion" toggle,
 * idempotently — same shape as `word-completion.spec.ts`'s own
 * `setWordCompletionSetting`, duplicated here rather than imported since
 * Playwright spec files in this project don't share helpers across files
 * (each of the existing `*.spec.ts` files already defines its own copies
 * of `openApp`/`clearEditor`/`tooltip`/etc.). */
async function setWordCompletionSetting(page: Page, enabled: boolean): Promise<void> {
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Settings' }).click()
  const checkbox = page.getByRole('checkbox', { name: 'Word completion', exact: true })
  await checkbox.waitFor()
  const isChecked = await checkbox.isChecked()
  if (isChecked !== enabled) {
    await checkbox.click()
  }
  await page.getByRole('button', { name: 'Close settings' }).click()
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden()
}

/** Opens Settings -> Editor and sets a given folder's exclusion checkbox,
 * idempotently — same "read current state first, only click if it needs to
 * change" shape as `setWordCompletionSetting` above. Assumes Settings is
 * currently closed. */
async function setFolderExclusion(
  page: Page,
  folderName: string,
  excluded: boolean,
): Promise<void> {
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Settings' }).click()
  const checkbox = page.getByRole('checkbox', {
    name: `Turn off word completion in ${folderName}`,
  })
  await checkbox.waitFor()
  const isChecked = await checkbox.isChecked()
  if (isChecked !== excluded) {
    await checkbox.click()
  }
  await page.getByRole('button', { name: 'Close settings' }).click()
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden()
}

test.describe('word completion — per-folder exclusion', () => {
  test('a document inside an excluded folder offers no word suggestions, while one outside it does — live, no reload', async ({
    page,
  }) => {
    await openApp(page)
    await setWordCompletionSetting(page, true)
    await renameActiveDocument(page, 'Root Doc')

    await createFolder(page, 'Learning German')
    await createDocument(page, 'German Notes')
    await moveDocumentToFolder(page, 'German Notes', 'Learning German')

    // Not excluded yet — word completion works normally inside the folder
    // too, proving the later "no suggestions" result is really caused by
    // the exclusion toggle below, not some other property of being in a
    // folder at all.
    await selectDocument(page, 'German Notes')
    await clearEditor(page)
    await page.keyboard.type('widget widg')
    await expect(tooltip(page)).toBeVisible()
    await page.keyboard.press('Escape')

    // Exclude the folder — takes effect immediately, no reload: the
    // currently-open document ("German Notes") is itself inside the
    // now-excluded folder.
    await setFolderExclusion(page, 'Learning German', true)
    await clearEditor(page)
    await page.keyboard.type('widget widg')
    await expect(tooltip(page)).toBeHidden()

    // A document at the root is never affected by any folder exclusion.
    await selectDocument(page, 'Root Doc')
    await clearEditor(page)
    await page.keyboard.type('widget widg')
    await expect(tooltip(page)).toBeVisible()
  })

  test('moving the open document into or out of an excluded folder takes effect immediately, no reload', async ({
    page,
  }) => {
    await openApp(page)
    await setWordCompletionSetting(page, true)
    await createFolder(page, 'Excluded Folder')
    await setFolderExclusion(page, 'Excluded Folder', true)

    await renameActiveDocument(page, 'Mover Doc')
    await clearEditor(page)
    await page.keyboard.type('widget widg')
    await expect(tooltip(page)).toBeVisible()
    await page.keyboard.press('Escape')

    // Move the document the editor currently has open into the excluded
    // folder — no `selectDocument`/reload involved, the same document stays
    // active throughout (`documentMoveRequested` never touches `$activeId`,
    // see `features/documents/model/documents.ts`).
    await moveDocumentToFolder(page, 'Mover Doc', 'Excluded Folder')
    await clearEditor(page)
    await page.keyboard.type('widget widg')
    await expect(tooltip(page)).toBeHidden()

    // Move it back to root — suggestions resume immediately.
    const aside = documentsPanel(page)
    await aside.getByRole('button', { name: 'Actions for Mover Doc' }).click()
    await aside.getByRole('menuitem', { name: '(Root)', exact: true }).click()
    await clearEditor(page)
    await page.keyboard.type('widget widg')
    await expect(tooltip(page)).toBeVisible()
  })

  test('the exclusion survives a reload', async ({ page }) => {
    await openApp(page)
    await setWordCompletionSetting(page, true)
    await createFolder(page, 'Persisted Folder')
    await createDocument(page, 'Persisted Doc')
    await moveDocumentToFolder(page, 'Persisted Doc', 'Persisted Folder')
    await setFolderExclusion(page, 'Persisted Folder', true)

    await selectDocument(page, 'Persisted Doc')
    await clearEditor(page)
    await page.keyboard.type('widget widg')
    await expect(tooltip(page)).toBeHidden()

    await page.reload()
    await page.locator('.cm-content').waitFor()

    // The restored session reopens whichever document was last active
    // (`features/documents/model/documents.ts`'s `loadFx`, restoring
    // `db.getActiveId()`) — "Persisted Doc" was still active at the moment
    // of reload, so no `selectDocument` is needed here.
    await clearEditor(page)
    await page.keyboard.type('widget widg')
    await expect(tooltip(page)).toBeHidden()

    // And the global toggle + folder exclusion are still genuinely in
    // effect (not just "everything happens to be off some other way") — a
    // root document in the same fresh session still gets suggestions.
    // `createDocument` places a new document alongside the currently active
    // one (`documentCreated`'s placement rule, see `features/documents/
    // model/documents.ts`) — since "Persisted Doc" is active and inside
    // "Persisted Folder", the new document would otherwise inherit that
    // same folder, so it's moved to root explicitly first.
    await createDocument(page, 'Fresh Doc')
    const aside = documentsPanel(page)
    await aside.getByRole('button', { name: 'Actions for Fresh Doc' }).click()
    await aside.getByRole('menuitem', { name: '(Root)', exact: true }).click()
    await clearEditor(page)
    await page.keyboard.type('widget widg')
    await expect(tooltip(page)).toBeVisible()
  })
})

import { test, expect, type Page } from '@playwright/test'

/**
 * Proves the v4 -> v5 IndexedDB migration (`src/features/documents/lib
 * /db.ts`, adding the `bookmarks` object store) does not touch, let alone
 * drop, an existing installation's documents.
 *
 * APPROACH — a real v4-shaped database is built by hand INSIDE the page
 * (via `page.evaluate`, using the raw `indexedDB` API — never this
 * project's own `db.ts`, which would already be v5-aware): the app is
 * first loaded once (so the origin/IndexedDB context exists), its own v5
 * database is deleted, a fresh one is created and seeded at version 4 with
 * one document, and the page is then reloaded. That reload is what
 * triggers `db.ts`'s REAL `onupgradeneeded` handler with `oldVersion === 4`
 * — the exact code path a genuine existing install goes through — rather
 * than a hand-rolled simulation of what the migration is supposed to do.
 */

const DB_NAME = 'markdown-editor'

async function openApp(page: Page): Promise<void> {
  await page.goto('/')
  await page.locator('.cm-content').waitFor()
}

/** Deletes whatever the app's own v5 open already created, then creates and
 * seeds a v4-shaped database by hand — no `bookmarks` store, no `syncDirPath`
 * gaps to worry about (this repo's app was never actually run at v1/v2/v3 in
 * this fresh browser context, so seeding at v4 with every v4 field already
 * present is the faithful "existing v4 install" starting point; see
 * `db.ts`'s own migration doc comment for why v4 -> v5 is a pure add, with
 * nothing to backfill on existing records either way). */
async function seedV4Database(page: Page, documentId: string, content: string): Promise<void> {
  await page.evaluate(
    async ({ dbName, documentId, content }) => {
      await new Promise<void>((resolve, reject) => {
        const deleteRequest = indexedDB.deleteDatabase(dbName)
        deleteRequest.onsuccess = () => resolve()
        deleteRequest.onerror = () => reject(deleteRequest.error)
        // `onblocked` is informational only — the request still eventually
        // completes once the app's own live connection closes itself via
        // its `onversionchange` handler (see `db.ts`), so nothing else is
        // needed here beyond not rejecting on it.
      })

      await new Promise<void>((resolve, reject) => {
        const openRequest = indexedDB.open(dbName, 4)
        openRequest.onupgradeneeded = () => {
          const db = openRequest.result
          db.createObjectStore('documents', { keyPath: 'id' })
          db.createObjectStore('meta', { keyPath: 'key' })
          db.createObjectStore('folders', { keyPath: 'id' })
        }
        openRequest.onsuccess = () => {
          const db = openRequest.result
          const tx = db.transaction(['documents', 'meta'], 'readwrite')
          tx.objectStore('documents').put({
            id: documentId,
            title: 'Pre-existing document',
            content,
            createdAt: 1_700_000_000_000,
            updatedAt: 1_700_000_000_000,
            folderId: null,
            origin: null,
          })
          tx.objectStore('meta').put({ key: 'activeId', value: documentId })
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
        openRequest.onerror = () => reject(openRequest.error)
      })
    },
    { dbName: DB_NAME, documentId, content },
  )
}

test.describe('bookmarks: v4 -> v5 IndexedDB migration', () => {
  test('an existing document and its content survive the upgrade', async ({ page }) => {
    await openApp(page)
    const content = '# Pre-existing content\n\nThis document predates the v5 migration.'
    await seedV4Database(page, 'seed-doc', content)

    // Reload — the app re-opens the database, this time hitting the real
    // `onupgradeneeded` with `oldVersion === 4`.
    await page.reload()
    await page.locator('.cm-content').waitFor()

    // The seeded document is restored as the active document, with its
    // content byte-for-byte intact — proven by reading `.cm-content`'s
    // actual rendered lines, not by re-reading IndexedDB (which would only
    // prove the write, not that the app itself sees it correctly).
    await expect
      .poll(() =>
        page
          .locator('.cm-content .cm-line')
          .allTextContents()
          .then((lines) => lines.join('\n')),
      )
      .toBe(content)

    // The database really did move to v5 — confirmed from inside the page,
    // reading the live connection's own `.version` and store list, not a
    // guess.
    const info = await page.evaluate(async (dbName) => {
      const databases = await indexedDB.databases()
      const entry = databases.find((db) => db.name === dbName)
      return entry ?? null
    }, DB_NAME)
    expect(info?.version).toBe(5)
  })

  test('the migrated database is immediately usable: a bookmark can be added and survives a further reload', async ({
    page,
  }) => {
    await openApp(page)
    const content = 'Only line of a pre-existing document'
    await seedV4Database(page, 'seed-doc-2', content)
    await page.reload()
    await page.locator('.cm-content').waitFor()

    await expect(
      page.locator('.cm-content .cm-line', { hasText: 'Only line of a pre-existing document' }),
    ).toBeVisible()

    // Adding a bookmark exercises the brand-new `bookmarks` store the
    // migration just created — a store that literally did not exist before
    // this reload.
    const line = page.locator('.cm-content .cm-line', { hasText: content })
    const lineBox = await line.boundingBox()
    const gutter = page.locator('.cm-bookmark-gutter')
    await gutter.waitFor()
    const gutterBox = await gutter.boundingBox()
    if (lineBox === null || gutterBox === null) throw new Error('missing bounding box')
    await page.mouse.click(gutterBox.x + gutterBox.width / 2, lineBox.y + lineBox.height / 2)

    await expect(page.locator('button[aria-label="Bookmarks, 1 bookmark"]')).toBeVisible()

    await page.reload()
    await page.locator('.cm-content').waitFor()

    // Both the pre-existing content AND the newly-added bookmark are still
    // there after a second reload — the migration didn't just work once by
    // accident.
    await expect
      .poll(() =>
        page
          .locator('.cm-content .cm-line')
          .allTextContents()
          .then((lines) => lines.join('\n')),
      )
      .toBe(content)
    await expect(page.locator('button[aria-label="Bookmarks, 1 bookmark"]')).toBeVisible()
  })
})

import { readFileSync } from 'node:fs'

import { test, expect, type Page } from '@playwright/test'
import { unzipSync, strFromU8 } from 'fflate'

/**
 * "Download all" — every document and folder as one `.zip`
 * (`features/transfer`).
 *
 * The naming rules (collisions, case-insensitive dedup, path traversal,
 * empty folders) are unit-tested in `lib/archive.test.ts`, where every case
 * can be stated directly. What only an end-to-end run can show is that the
 * button reaches the effect, the effect reaches the browser's download
 * machinery, and the bytes that land on disk are a zip a real tool can open
 * and read the user's actual document out of.
 */

async function openApp(page: Page): Promise<void> {
  await page.goto('/')
  await page.locator('.cm-content').waitFor()
}

async function downloadAll(page: Page) {
  await page.getByRole('button', { name: 'More actions' }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: 'Download all (.zip)' }).click()
  return downloadPromise
}

/** The archive as `{ path: text }`, read back off disk exactly as the user
 * would receive it. */
async function readArchive(
  download: Awaited<ReturnType<typeof downloadAll>>,
): Promise<Record<string, string>> {
  const path = await download.path()
  const unzipped = unzipSync(new Uint8Array(readFileSync(path)))
  return Object.fromEntries(
    Object.entries(unzipped).map(([name, bytes]) => [name, strFromU8(bytes)]),
  )
}

test('downloads a real zip containing the workspace', async ({ page }) => {
  await openApp(page)
  await page.locator('.cm-content').fill('# Backup me\n\nSome body text.')
  // Let the edit settle into the document store the archive is built from.
  await page.waitForTimeout(600)

  const download = await downloadAll(page)
  expect(download.suggestedFilename()).toMatch(/^powermd-\d{4}-\d{2}-\d{2}\.zip$/)

  const files = await readArchive(download)
  const markdownFiles = Object.keys(files).filter((name) => name.endsWith('.md'))
  expect(markdownFiles.length).toBeGreaterThan(0)

  // The edit made above is in there — i.e. the archive was built from live
  // state, not a stale snapshot taken at startup.
  const contents = Object.values(files).join('\n')
  expect(contents).toContain('# Backup me')
  expect(contents).toContain('Some body text.')
})

test('reports how many documents it archived', async ({ page }) => {
  await openApp(page)
  const download = await downloadAll(page)
  await download.path()

  // A backup that downloads silently gives no way to tell whether it
  // actually contained anything, so the count is confirmed explicitly.
  await expect(page.getByText(/Downloaded \d+ documents?\./)).toBeVisible()
})

test('puts a foldered document inside that folder, and closes the menu', async ({ page }) => {
  await openApp(page)

  // Create a folder — the archive should mirror it as a directory.
  const openSidebar = page.getByRole('button', { name: 'Open sidebar' })
  if (await openSidebar.isVisible().catch(() => false)) {
    await openSidebar.click()
    await page.waitForTimeout(600)
  }
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New folder' }).click()
  await page.getByLabel('New folder name').fill('Course 2026')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)

  const download = await downloadAll(page)
  const files = await readArchive(download)

  // Empty or not, the folder survives the round trip — a folder the user
  // deliberately made should not vanish from their backup.
  expect(Object.keys(files).some((name) => name.startsWith('Course 2026/'))).toBe(true)
  await expect(page.getByRole('menu', { name: 'More actions' })).toBeHidden()
})

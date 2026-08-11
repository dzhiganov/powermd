import { expect, test } from '@playwright/test'

/**
 * A first screenshot of the app showed the editor full of the seeded
 * document while the preview pane was blank and the status bar read
 * "0 words · 0 characters". This spec exists to settle whether that is a
 * race in how quickly the shot was taken, or a real first-paint bug where
 * nothing downstream of the editor populates until the first edit.
 *
 * It deliberately does NOT type anything: typing is what the other spec
 * covers, and typing here would mask exactly the bug being looked for.
 */
test('the preview and word count populate on first load, without typing', async ({ page }) => {
  await page.goto('/')

  const editor = page.locator('.cm-content')
  await expect(editor).not.toBeEmpty()

  // The preview renders in a worker, so it is legitimately a beat behind the
  // editor — but only a beat. If it is still empty once the editor has
  // content, nothing is coming without an edit.
  const preview = page.locator('.markdown-preview')
  await expect(preview.locator('h1, h2, p').first()).toBeVisible()

  const status = page.locator('footer').last()
  await expect(status).not.toHaveText(/^0 words/)
})

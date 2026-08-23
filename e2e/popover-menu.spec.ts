import { test, expect, type Page } from '@playwright/test'

/**
 * `PopoverMenu` (`src/shared/ui/PopoverMenu.vue`) is the shared shell
 * behind every dismissible menu in the app now, including the export menu
 * — which used to be a daisyUI CSS-only `:focus-within` dropdown with no
 * Escape handling, no focus trap, and no outside-click dismissal of its
 * own (it only closed by blurring the focused item). These tests drive
 * the export menu's keyboard/outside-click behaviour end-to-end through a
 * real Playwright tab (never the CDP-attached pane used for manual
 * verification during development — that pane reports `document.hidden
 * === true`, which breaks focus-return assertions), and repeat the same
 * two dismissal checks against the header's "More actions" menu to prove
 * the behaviour is genuinely shared, not re-implemented per caller.
 */

async function openApp(page: Page): Promise<void> {
  await page.goto('/')
  await page.locator('.cm-content').waitFor()
}

test.describe('export menu (PopoverMenu)', () => {
  test('opens on click and lists every export/copy action', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: 'Export document' }).click()

    await expect(page.getByRole('menu', { name: 'Export document' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Markdown (.md)' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Styled HTML (.html)' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Print / PDF' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Copy Markdown' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Copy rendered HTML' })).toBeVisible()
  })

  test('Escape closes the menu and returns focus to the trigger', async ({ page }) => {
    await openApp(page)
    const trigger = page.getByRole('button', { name: 'Export document' })
    await trigger.click()
    const menu = page.getByRole('menu', { name: 'Export document' })
    await expect(menu).toBeVisible()

    await page.keyboard.press('Escape')

    await expect(menu).toBeHidden()
    await expect(trigger).toBeFocused()
  })

  test('an outside click dismisses the menu', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: 'Export document' }).click()
    const menu = page.getByRole('menu', { name: 'Export document' })
    await expect(menu).toBeVisible()

    // The editor body sits nowhere near the header's export popover.
    await page.locator('.cm-content').click()

    await expect(menu).toBeHidden()
  })

  test('choosing "Markdown (.md)" still triggers a download', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: 'Export document' }).click()

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('menuitem', { name: 'Markdown (.md)' }).click()
    const download = await downloadPromise

    expect(download.suggestedFilename()).toMatch(/\.md$/)
  })
})

test.describe('more actions menu (PopoverMenu) — same shared behaviour', () => {
  test('Escape closes the menu and returns focus to the trigger', async ({ page }) => {
    await openApp(page)
    const trigger = page.getByRole('button', { name: 'More actions' })
    await trigger.click()
    const menu = page.getByRole('menu', { name: 'More actions' })
    await expect(menu).toBeVisible()

    await page.keyboard.press('Escape')

    await expect(menu).toBeHidden()
    await expect(trigger).toBeFocused()
  })

  test('an outside click dismisses the menu', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: 'More actions' }).click()
    const menu = page.getByRole('menu', { name: 'More actions' })
    await expect(menu).toBeVisible()

    await page.locator('.cm-content').click()

    await expect(menu).toBeHidden()
  })
})

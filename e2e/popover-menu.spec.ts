import { test, expect, type Page } from '@playwright/test'

/**
 * `PopoverMenu` (`src/shared/ui/PopoverMenu.vue`) is the shared shell
 * behind every dismissible menu in the app. These tests drive its
 * keyboard/outside-click behaviour end-to-end through a real Playwright tab
 * (never the CDP-attached pane used for manual verification during
 * development — that pane reports `document.hidden === true`, which breaks
 * focus-return assertions).
 *
 * There is one menu to drive now, not two. The export actions used to have
 * their own trigger and popover next to this one in the documents panel's
 * tools row; they are rows inside the "…" menu now (user request — see
 * `layout/ui/MoreMenu.vue`), so the export coverage below opens "More
 * actions" and looks for the same five rows there.
 */

async function openApp(page: Page): Promise<void> {
  await page.goto('/')
  await page.locator('.cm-content').waitFor()
}

async function openMoreMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'More actions' }).click()
  await expect(page.getByRole('menu', { name: 'More actions' })).toBeVisible()
}

test.describe('export actions, inside the More menu', () => {
  test('lists every export/copy action', async ({ page }) => {
    await openApp(page)
    await openMoreMenu(page)

    await expect(page.getByRole('menuitem', { name: 'Markdown (.md)' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Styled HTML (.html)' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Print / PDF' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Copy Markdown' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Copy rendered HTML' })).toBeVisible()
  })

  test('the theme, import and settings rows moved here too', async ({ page }) => {
    await openApp(page)
    await openMoreMenu(page)

    await expect(
      page.getByRole('menuitem', { name: /Switch to (dark|system|schedule|light) theme/ }),
    ).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /^Import / })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Settings' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Keyboard shortcuts' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'About' })).toBeVisible()
  })

  test('choosing "Markdown (.md)" still triggers a download, and closes the menu', async ({
    page,
  }) => {
    await openApp(page)
    await openMoreMenu(page)

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('menuitem', { name: 'Markdown (.md)' }).click()
    const download = await downloadPromise

    expect(download.suggestedFilename()).toMatch(/\.md$/)
    await expect(page.getByRole('menu', { name: 'More actions' })).toBeHidden()
  })

  test('the theme row is the one that does NOT close the menu', async ({ page }) => {
    await openApp(page)
    await page.evaluate(() => localStorage.setItem('markdown-editor:theme', 'light'))
    await page.reload()
    await page.locator('.cm-content').waitFor()
    await openMoreMenu(page)

    const themeRow = page.getByRole('menuitem', {
      name: /Switch to (dark|system|schedule|light) theme/,
    })
    await themeRow.click()

    // Still open, and the row has re-labelled itself in place — this is what
    // makes cycling possible without reopening the menu between steps.
    await expect(page.getByRole('menu', { name: 'More actions' })).toBeVisible()
    await expect(themeRow).toHaveAttribute('aria-label', 'Switch to system theme')
  })
})

test.describe('more actions menu (PopoverMenu) — shared dismissal behaviour', () => {
  test('the first row is focused the moment the menu opens', async ({ page }) => {
    await openApp(page)
    await openMoreMenu(page)

    // Regression guard. That first row is a COMPONENT
    // (`<ThemeToggle menu-item />`), and a `:ref` on a component yields a
    // ComponentPublicInstance rather than an HTMLElement — which used to
    // leave `firstItemRef` null and focus stranded on the trigger, silently.
    // Escape then did nothing, because the keydown handler lives on the
    // panel and no focus was inside it. See `shared/lib/useDialog.ts`.
    const themeRow = page.getByRole('menuitem', {
      name: /Switch to (dark|system|schedule|light) theme/,
    })
    await expect(themeRow).toBeFocused()
  })

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

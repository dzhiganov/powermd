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

    // The theme control is a three-icon segmented switcher, not a labelled
    // row — each mode is its own button, named only by its `aria-label`
    // (there is no visible text to match on).
    await expect(page.getByRole('menuitem', { name: 'Light theme' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Dark theme' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'System theme' })).toBeVisible()
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

  test('the theme switcher is the one control that does NOT close the menu', async ({ page }) => {
    await openApp(page)
    await page.evaluate(() => localStorage.setItem('markdown-editor:theme', 'light'))
    await page.reload()
    await page.locator('.cm-content').waitFor()
    await openMoreMenu(page)

    const lightSegment = page.getByRole('menuitem', { name: 'Light theme' })
    const darkSegment = page.getByRole('menuitem', { name: 'Dark theme' })
    await expect(lightSegment).toHaveAttribute('aria-pressed', 'true')

    await darkSegment.click()

    // The picked mode is applied outright — no cycling, so one click on
    // "Dark theme" from 'light' lands on dark rather than stepping toward it.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    // Still open, with the active segment moved in place. That is what makes
    // switching themes while watching the result possible without reopening
    // the menu between attempts.
    await expect(page.getByRole('menu', { name: 'More actions' })).toBeVisible()
    await expect(darkSegment).toHaveAttribute('aria-pressed', 'true')
    await expect(lightSegment).toHaveAttribute('aria-pressed', 'false')
  })
})

test.describe('more actions menu (PopoverMenu) — shared dismissal behaviour', () => {
  test('the first row is focused the moment the menu opens', async ({ page }) => {
    await openApp(page)
    await openMoreMenu(page)

    // Regression guard, and the first focusable thing in this panel is now
    // the theme switcher's first SEGMENT ("Light theme"), not a labelled
    // row. `MoreMenu.vue` deliberately passes no `setFirstItemRef` for it —
    // the switcher's component root is the track `<div>` holding the three
    // buttons, and `.focus()` on a plain div does nothing — so this also
    // covers `useDialogFocusTrap`'s "derive the first focusable element from
    // the DOM" fallback. Without that fallback, focus stays stranded on the
    // trigger silently, and Escape then does nothing because the keydown
    // handler lives on the panel. See `shared/lib/useDialog.ts`.
    await expect(page.getByRole('menuitem', { name: 'Light theme' })).toBeFocused()
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

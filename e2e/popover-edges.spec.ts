import { test, expect, type Page } from '@playwright/test'

/**
 * Menus in the documents panel's tools row must stay inside the window on
 * BOTH dock sides.
 *
 * A right-aligned panel grows leftward from its trigger. The tools row
 * mirrors with the dock side, so once the panel could dock left the row sat
 * against the left edge of the window and its menus opened straight off it
 * — the More menu's contents were clipped and unreadable. Nothing else
 * catches this: the menus opened, focus trapped, items were present and
 * clickable, contrast was fine. The only thing wrong was where the panel
 * landed relative to the window, so that is what this measures.
 */

const DRAWER_SIDE_KEY = 'markdown-editor:drawer-side'

async function openWithSide(page: Page, side: 'left' | 'right'): Promise<void> {
  await page.addInitScript(([key, value]) => localStorage.setItem(key as string, value as string), [
    DRAWER_SIDE_KEY,
    side,
  ] as const)
  await page.goto('/')
  await page.locator('.cm-content').waitFor()
  // Settle the panel so the tools row is at its final x before measuring.
  await page.waitForTimeout(500)
}

for (const side of ['right', 'left'] as const) {
  for (const menu of [
    { trigger: 'More actions', panel: 'More actions' },
    { trigger: 'Export document', panel: 'Export document' },
  ]) {
    test(`${menu.trigger} stays fully on screen with the panel docked ${side}`, async ({
      page,
    }) => {
      await openWithSide(page, side)

      await page.getByRole('button', { name: menu.trigger }).click()
      const panel = page.locator(`[role="menu"][aria-label="${menu.panel}"]`)
      await panel.waitFor()

      const box = (await panel.boundingBox())!
      const viewport = (await page.viewportSize())!

      expect(box.x, `${menu.trigger} (${side}): left edge is on screen`).toBeGreaterThanOrEqual(0)
      expect(
        box.x + box.width,
        `${menu.trigger} (${side}): right edge is on screen`,
      ).toBeLessThanOrEqual(viewport.width)
    })
  }
}

import { test, expect, type Page } from '@playwright/test'

/**
 * The menu in the documents panel's tools row must stay inside the window on
 * BOTH dock sides.
 *
 * A right-aligned panel grows leftward from its trigger. The tools row
 * mirrors with the dock side, so once the panel could dock left the row sat
 * against the left edge of the window and its menu opened straight off it —
 * the contents were clipped and unreadable. Nothing else catches this: the
 * menu opened, focus trapped, items were present and clickable, contrast was
 * fine. The only thing wrong was where the panel landed relative to the
 * window, so that is what this measures.
 *
 * One menu, not two: the export actions used to have a second trigger next
 * to this one and were measured separately. They are rows inside this same
 * menu now (`layout/ui/MoreMenu.vue`), so they are covered by it — and since
 * they made it the widest panel in the app (256px), this measures the worst
 * case rather than a narrower one.
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
  test(`More actions stays fully on screen with the panel docked ${side}`, async ({ page }) => {
    await openWithSide(page, side)

    await page.getByRole('button', { name: 'More actions' }).click()
    const panel = page.locator('[role="menu"][aria-label="More actions"]')
    await panel.waitFor()

    const box = (await panel.boundingBox())!
    const viewport = (await page.viewportSize())!

    expect(box.x, `docked ${side}: left edge is on screen`).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, `docked ${side}: right edge is on screen`).toBeLessThanOrEqual(
      viewport.width,
    )
  })
}

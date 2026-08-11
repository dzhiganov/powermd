import { test, expect } from '@playwright/test'

// The docked documents sidebar (DocumentDrawer.vue) slides via
// `transition-transform duration-500 ease-out` — `translate-x-0` while
// open, `translate-x-full` while closed (default dock side is 'right', so
// closing moves the panel further right, off-screen). This asserts an
// in-flight animation frame, not just the two endpoints: in the
// CDP-attached browser pane used for manual verification this session
// (`document.hidden === true`), CSS transitions never run at all and the
// panel would jump straight from the open box to the closed box with
// nothing observable in between.
test('the docked sidebar transition actually animates instead of jumping to its end state', async ({
  page,
}) => {
  await page.goto('/')

  // The drawer defaults to open (readInitialDrawerOpen in
  // src/features/documents/model/documents.ts), so the toggle starts
  // labelled "Close documents".
  const toggle = page.getByRole('button', { name: 'Close documents' })
  const panel = page.locator('aside[aria-label="Documents"] > div')

  const openBox = await panel.boundingBox()
  if (!openBox) throw new Error('Sidebar panel has no bounding box while open')

  // Attached before the click so it can't miss the event — resolved after,
  // this is the deterministic half of the test: proof the transition
  // actually finishes, not a timeout standing in for it.
  const transitionEnded = panel.evaluate(
    (el) =>
      new Promise<void>((resolve) => {
        el.addEventListener('transitionend', () => resolve(), { once: true })
      }),
  )

  await toggle.click()

  // The one genuinely time-based wait in this suite: sampling a moment
  // inside a fixed, known 500ms CSS transition is the only way to observe
  // an in-flight animation frame — there is no store/attribute/network
  // signal to await instead, since the animation is purely presentational.
  // 200ms is comfortably inside the 500ms duration on either side (started,
  // not yet finished), not a guess at when the whole operation "should" be
  // done.
  await page.waitForTimeout(200)
  const midBox = await panel.boundingBox()
  if (!midBox) throw new Error('Sidebar panel has no bounding box mid-transition')

  await transitionEnded
  const closedBox = await panel.boundingBox()
  if (!closedBox) throw new Error('Sidebar panel has no bounding box after the transition')

  expect(midBox.x).toBeGreaterThan(openBox.x)
  expect(midBox.x).toBeLessThan(closedBox.x)
})

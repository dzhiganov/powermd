import { test, expect, type Page } from '@playwright/test'

// The docked documents sidebar (DocumentDrawer.vue) slides via TWO
// simultaneous transitions: the outer wrapper (`<aside>`) animates `width`
// (`md:w-80` <-> `md:w-0`, reclaiming/yielding layout space from `<main>`),
// and the inner panel (constant-width `<div>`) animates `transform`
// (`translate-x-0` <-> `translate-x-full`). Both run on the same
// `duration-500 ease-out`. This file proves two separate things about that
// pair: that it animates at all (not just endpoint-jumps — the first test
// below), and that the two curves actually describe the SAME visual edge
// over time rather than merely sharing endpoints (the mid-flight sync tests
// further down — see their own doc comment for why that distinction needed
// its own regression test).
//
// Both matter specifically because of the CDP-attached browser pane used for
// manual verification during development: it reports `document.hidden ===
// true`, so CSS transitions never run there at all, and neither desync bug
// this file guards against would be observable through it — only a real,
// foregrounded tab (this Playwright suite) can see either one.
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

/**
 * Samples, via `requestAnimationFrame`, the gap between the panel's own
 * leading edge and the pane boundary (`<main>`'s adjacent edge) at every
 * frame for ~650ms starting the instant the toggle is clicked (500ms
 * transition + margin). For `side: 'right'` the panel's LEADING edge during
 * either direction is its LEFT edge (`panel.left`) and the pane boundary is
 * `main.right`; mirrored for `side: 'left'`.
 *
 * Before the `DocumentDrawer.vue` fix (outer wrapper width animation +
 * inner panel transform, both driven by the same shared eased-progress
 * fraction) the panel was a normal in-flow child of the width-animating
 * wrapper, so its un-transformed resting position ALSO moved as that width
 * changed — on top of (not instead of) the deliberate transform — doubling
 * its total range of motion relative to the pane boundary's own 320px
 * range. The gap between the two collapsed to exactly 0 only in the last
 * instant of the transition (`delta = 320px * (1 - easedProgress)`, a
 * straight line to zero at completion), staying large — 320px, the full
 * drawer width — through virtually the entire animation. Fixing it (the
 * panel now `position: absolute`, pinned to the same edge the wrapper
 * itself is pinned to, so ONLY the transform moves it) makes that gap ~0 at
 * every sampled frame, not just the two endpoints — what this helper
 * actually asserts.
 */
async function sampleLeadingEdgeGap(
  page: Page,
  side: 'left' | 'right',
): Promise<{ t: number; delta: number }[]> {
  return page.evaluate((side) => {
    return new Promise<{ t: number; delta: number }[]>((resolve) => {
      const main = document.querySelector('main')
      const panel = document.querySelector('aside[aria-label="Documents"] > div')
      if (!main || !panel) return resolve([])
      const samples: { t: number; delta: number }[] = []
      const start = performance.now()
      function tick() {
        const t = performance.now() - start
        const mainRect = main!.getBoundingClientRect()
        const panelRect = panel!.getBoundingClientRect()
        const delta =
          side === 'right' ? panelRect.left - mainRect.right : mainRect.left - panelRect.right
        samples.push({ t, delta })
        if (t < 650) {
          requestAnimationFrame(tick)
        } else {
          resolve(samples)
        }
      }
      requestAnimationFrame(tick)
    })
  }, side)
}

test.describe('the panel leading edge and the pane boundary move as one', () => {
  test('opening: the gap stays near zero throughout, not just at the endpoints', async ({
    page,
  }) => {
    await page.goto('/')
    // Start from a settled closed state so the sampled transition is a
    // clean open.
    await page.getByRole('button', { name: 'Close documents' }).click()
    await expect
      .poll(async () => (await page.locator('aside[aria-label="Documents"]').boundingBox())?.width)
      .toBeLessThan(5)

    const samplesPromise = sampleLeadingEdgeGap(page, 'right')
    await page.getByRole('button', { name: 'Open documents' }).click()
    const samples = await samplesPromise

    // At least several frames actually landed mid-transition (not just the
    // two endpoints) — otherwise this would silently degrade into the same
    // weak endpoints-only assertion the test above already makes.
    const midFlight = samples.filter((s) => s.t > 50 && s.t < 450)
    expect(midFlight.length).toBeGreaterThan(3)

    // 2px tolerance for rAF-vs-compositor sampling jitter — comfortably
    // tighter than the up-to-320px (full drawer width) gap the pre-fix
    // double-motion produced at these same mid-flight points.
    for (const sample of midFlight) {
      expect(Math.abs(sample.delta), `t=${sample.t.toFixed(0)}ms`).toBeLessThan(2)
    }
  })

  test('closing: the gap stays near zero throughout, not just at the endpoints', async ({
    page,
  }) => {
    await page.goto('/')
    // Drawer defaults open — sample the close transition directly.
    const samplesPromise = sampleLeadingEdgeGap(page, 'right')
    await page.getByRole('button', { name: 'Close documents' }).click()
    const samples = await samplesPromise

    const midFlight = samples.filter((s) => s.t > 50 && s.t < 450)
    expect(midFlight.length).toBeGreaterThan(3)
    for (const sample of midFlight) {
      expect(Math.abs(sample.delta), `t=${sample.t.toFixed(0)}ms`).toBeLessThan(2)
    }
  })

  test('docked LEFT: the gap stays near zero throughout too — the fix is symmetric, not right-side-only', async ({
    page,
  }) => {
    await page.goto('/')
    // Dock left via the drawer's own footer control (no Settings round
    // trip needed — `DocumentDrawer.vue`'s footer exposes the same
    // `$drawerSide` preference directly).
    await page.getByRole('button', { name: 'Dock sidebar left' }).click()
    await expect(page.locator('aside[aria-label="Documents"]')).toHaveClass(/order-1/)

    const samplesPromise = sampleLeadingEdgeGap(page, 'left')
    await page.getByRole('button', { name: 'Close documents' }).click()
    const samples = await samplesPromise

    const midFlight = samples.filter((s) => s.t > 50 && s.t < 450)
    expect(midFlight.length).toBeGreaterThan(3)
    for (const sample of midFlight) {
      expect(Math.abs(sample.delta), `t=${sample.t.toFixed(0)}ms`).toBeLessThan(2)
    }
  })
})

test('the panel never reflows its own contents during the transition — only its position moves', async ({
  page,
}) => {
  await page.goto('/')
  // The "New" button spans the panel's own full (constant) width — if the
  // panel's CONTENT box were ever resized during the animation (rather than
  // just repositioned), this button's own width would visibly change frame
  // to frame. Sampled the same way the sync tests above sample position —
  // the evaluate call is kicked off (not awaited) BEFORE the click, so its
  // in-page rAF loop is already running when the transition starts.
  const samplesPromise = page.evaluate(() => {
    return new Promise<number[]>((resolve) => {
      const button = document.querySelector(
        'aside[aria-label="Documents"] button[aria-label="New"]',
      )
      if (!button) return resolve([])
      const widths: number[] = []
      const start = performance.now()
      function tick() {
        widths.push(button!.getBoundingClientRect().width)
        if (performance.now() - start < 650) {
          requestAnimationFrame(tick)
        } else {
          resolve(widths)
        }
      }
      requestAnimationFrame(tick)
    })
  })
  await page.getByRole('button', { name: 'Close documents' }).click()
  const samples = await samplesPromise

  expect(samples.length).toBeGreaterThan(3)
  const first = samples[0]
  for (const width of samples) {
    // Sub-pixel layout rounding tolerance only — the button's box must stay
    // effectively constant, never reflowing to a different size mid-slide.
    expect(Math.abs(width - first)).toBeLessThan(1)
  }
})

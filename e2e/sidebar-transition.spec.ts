import { test, expect, type Page } from '@playwright/test'

// The documents sidebar (`DocumentDrawer.vue`) and its toggle
// (`DrawerToggleButton.vue`) are now ONE coupled system rather than two
// independently-animated pieces: a single persistent toggle button, pinned
// against `AppShell.vue`'s shell, travels from the header's corner to a
// spot just inside the panel's own top row whenever the drawer opens — and
// the panel itself slides in from the same trigger, on the exact same
// `340ms cubic-bezier(0.22, 0.61, 0.36, 1)` (`main.css`'s
// `--md-motion-duration`/`--md-motion-ease`). This file used to test a
// different pairing entirely (an outer wrapper's `width` transition vs an
// inner panel's `transform`, both animating the SAME 320px range so their
// edges were expected to coincide almost exactly at every frame — see git
// history for that mechanism, since replaced outright rather than kept
// working). The button and the panel do NOT share a range (the panel
// travels its own full width; the button travels a shorter, formula-
// derived distance so it lands inside the panel rather than off the edge
// of it — see `DrawerToggleButton.vue`'s own comment), so "they move
// together" now means something more precise than "their edges line up":
// at any instant, the button's progress through ITS OWN travel range must
// match the panel's progress through ITS OWN travel range, because both
// are driven by the identical shared duration/easing curve from the same
// trigger. `expectProgressTracks` below asserts exactly that — not "the
// two edges are near each other" (they usually aren't) but "the fraction
// of the button's journey completed at time t equals the fraction of the
// panel's journey completed at time t".
//
// Both movement AND that synchrony matter specifically because of the
// CDP-attached browser pane used for manual verification during
// development: it reports `document.hidden === true`, so CSS transitions
// never run there at all — only a real, foregrounded tab (this Playwright
// suite) can observe either one.

/** Locates the toggle by a selector that survives its accessible name
 * changing between "Open sidebar" and "Close sidebar" — `.sidebar-toggle`
 * is the component's own scoped class (`DrawerToggleButton.vue`), stable
 * across both states and, unlike the aria-label, unaffected by `side`. */
function toggleLocator(page: Page) {
  return page.locator('button.sidebar-toggle')
}

function panelLocator(page: Page) {
  return page.locator('aside[aria-label="Documents"]')
}

/**
 * The button is actually PAINTED, in both states — not merely present at
 * the right coordinates.
 *
 * This exists because it once wasn't. The class was named `drawer-toggle`,
 * which is daisyUI's own class for the hidden checkbox inside its drawer
 * component, and daisyUI ships `opacity: 0` on it. The button measured a
 * correct 28x28 at a correct corner offset, its two icons each reported the
 * opacity the morph expected, the labels changed, the travel arithmetic was
 * right — and nothing was drawn on screen. Every assertion about position
 * and about the icons passed, because none of them asked whether the thing
 * containing them was visible.
 *
 * `toBeVisible` alone would not have caught it either: Playwright treats a
 * zero-opacity element as visible, since opacity does not affect hit
 * testing. So this checks the computed opacity of the button and of the
 * icon that is supposed to be showing, and that the point at the button's
 * centre actually hits the button rather than whatever is behind it.
 */
test('the toggle is actually painted in both states, not just correctly positioned', async ({
  page,
}) => {
  await page.goto('/')
  const toggle = toggleLocator(page)

  const paintedState = () =>
    toggle.evaluate((btn) => {
      const box = btn.getBoundingClientRect()
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
      const icons = [...btn.querySelectorAll('span')].map((s) =>
        Number(getComputedStyle(s).opacity),
      )
      return {
        buttonOpacity: Number(getComputedStyle(btn).opacity),
        visibility: getComputedStyle(btn).visibility,
        // The morph keeps both icons mounted, so exactly one of them should
        // be at full strength at rest.
        strongestIcon: Math.max(...icons),
        centreHitsButton: btn.contains(hit) || hit === btn,
      }
    })

  for (const expectedLabel of ['Close sidebar', 'Open sidebar'] as const) {
    await expect(toggle).toHaveAccessibleName(expectedLabel)
    const state = await paintedState()
    expect(state.buttonOpacity, `${expectedLabel}: button opacity`).toBeGreaterThan(0.9)
    expect(state.visibility, `${expectedLabel}: visibility`).toBe('visible')
    expect(state.strongestIcon, `${expectedLabel}: an icon is at full strength`).toBeGreaterThan(
      0.9,
    )
    expect(state.centreHitsButton, `${expectedLabel}: centre hit-tests to the button`).toBe(true)
    await toggle.click()
    await page.waitForTimeout(450)
  }
})

test('the toggle is a single persistent element — proof it is never unmounted across a full open/close cycle', async ({
  page,
}) => {
  await page.goto('/')
  const toggle = toggleLocator(page)

  // A property set directly on the live DOM node (not an attribute in the
  // template) survives only as long as THAT node does — if Vue ever
  // unmounted this button and mounted a fresh one for the other state (the
  // one thing a v-if/v-else pair between a header-docked copy and a
  // drawer-docked copy would do), the marker would be gone the moment we
  // look for it again. This is the DOM-identity-level version of that
  // check, one level more direct than accessible-name assertions.
  await toggle.evaluate((el) => {
    ;(el as HTMLElement & { __e2eMarker?: string }).__e2eMarker = 'same-node'
  })

  // The drawer defaults open (`readInitialDrawerOpen`,
  // `src/features/documents/model/documents.ts`), so this starts as
  // "Close sidebar".
  await expect(toggle).toHaveAccessibleName('Close sidebar')
  await toggle.click()
  await expect(toggle).toHaveAccessibleName('Open sidebar')
  const markerAfterClose = await toggle.evaluate(
    (el) => (el as HTMLElement & { __e2eMarker?: string }).__e2eMarker,
  )
  expect(markerAfterClose, 'marker survives the close — same node, not a fresh one').toBe(
    'same-node',
  )

  await toggle.click()
  await expect(toggle).toHaveAccessibleName('Close sidebar')
  const markerAfterReopen = await toggle.evaluate(
    (el) => (el as HTMLElement & { __e2eMarker?: string }).__e2eMarker,
  )
  expect(markerAfterReopen, 'marker survives the reopen too').toBe('same-node')

  // And there is genuinely only one of it in the whole document — no
  // second copy rendered inside the drawer itself.
  await expect(toggleLocator(page)).toHaveCount(1)
})

/** Resolves once the panel's own `transitionend` fires — a deterministic
 * settle signal, unlike polling a loose threshold on its position (which
 * is satisfied the moment the panel has moved a FEW px, not once it has
 * finished moving all 320 of them; under parallel worker contention that
 * gap between "started" and "finished" is exactly wide enough to read a
 * mid-flight box and call it settled). Must be attached before the click
 * that triggers the transition, same reasoning as the old file's own
 * `transitionEnded` promise. */
function waitForPanelSettle(panel: ReturnType<typeof panelLocator>): Promise<void> {
  return panel.evaluate(
    (el) =>
      new Promise<void>((resolve) => {
        el.addEventListener('transitionend', () => resolve(), { once: true })
      }),
  )
}

test('closed and open positions: the button starts at the header corner and lands 12px clear of the panel divider', async ({
  page,
}) => {
  await page.goto('/')
  const toggle = toggleLocator(page)
  const panel = panelLocator(page)

  // Drawer defaults open — close it first so "closed" is a settled state,
  // not a snapshot mid-transition.
  const closeSettled = waitForPanelSettle(panel)
  await toggle.click()
  await expect(toggle).toHaveAccessibleName('Open sidebar')
  await closeSettled

  const closedBox = (await toggle.boundingBox())!
  const viewportWidth = (await page.viewportSize())!.width
  // spec: `top: 12px; right: 14px` for a right-docked (default) sidebar.
  // Sub-2px tolerance for browser sub-pixel rounding, not a real margin of
  // doubt about the value.
  expect(Math.abs(closedBox.y - 12), 'closed: top offset').toBeLessThan(2)
  expect(
    Math.abs(viewportWidth - (closedBox.x + closedBox.width) - 14),
    'closed: right offset',
  ).toBeLessThan(2)

  const openSettled = waitForPanelSettle(panel)
  await toggle.click()
  await expect(toggle).toHaveAccessibleName('Close sidebar')
  await openSettled

  const openBox = (await toggle.boundingBox())!
  const panelBox = (await panel.boundingBox())!

  // The button's leading (left) edge must land 12px clear of the panel's
  // own leading (left) edge — the divider between the panel and the pane
  // behind it — per the spec's arithmetic (rail width - corner offset -
  // button width - panel inset).
  expect(
    Math.abs(openBox.x - panelBox.x - 12),
    'open: 12px clear of the panel divider',
  ).toBeLessThan(2.5)
  // And it travelled left, into the panel, not merely stayed at its corner.
  expect(openBox.x).toBeLessThan(closedBox.x)
})

interface Endpoints {
  panelClosedX: number
  panelOpenX: number
  buttonClosedX: number
  buttonOpenX: number
}

/**
 * Measures both elements' CLOSED and OPEN resting x with motion switched
 * off, rather than deriving the endpoints from the app's own CSS custom
 * properties (`--md-sidebar-width` etc.) — a custom property holding a
 * `calc()` expression serialises back out as the unevaluated token string,
 * not a resolved pixel number, so reading it in-page and `parseFloat`-ing
 * it is not a reliable way to get `266`. Real `boundingBox()` reads in
 * both settled states sidesteps that entirely, and reuses the app's own
 * `prefers-reduced-motion` handling (`main.css`) to reach both settled
 * states instantly instead of waiting through two real 340ms transitions
 * just to find out where they end. Leaves `page` on `side`, closed, with
 * motion restored, ready for the caller's own sampled click. */
async function measureEndpoints(page: Page, side: 'left' | 'right'): Promise<Endpoints> {
  const toggle = toggleLocator(page)
  const panel = panelLocator(page)

  // Motion off FIRST — docking left/right swaps which of
  // `.sidebar-toggle-{left,right}.is-open`'s rules applies (the button's own
  // `transform` goes from e.g. `translateX(-266px)` to `translateX(266px)`
  // in one render), and that IS one of the properties `.sidebar-toggle`
  // transitions unconditionally. Flipping the dock side under full motion
  // would kick off a real, undesired 340ms sweep across the screen; doing
  // it after `reducedMotion: 'reduce'` collapses that to an instant jump
  // like everything else here.
  await page.emulateMedia({ reducedMotion: 'reduce' })

  if (side === 'left') {
    await page.getByRole('button', { name: 'Dock sidebar left' }).click()
  }

  if ((await toggle.getAttribute('aria-pressed')) === 'false') {
    await toggle.click()
  }
  await expect(toggle).toHaveAccessibleName('Close sidebar')
  const openPanel = (await panel.boundingBox())!
  const openButton = (await toggle.boundingBox())!

  await toggle.click()
  await expect(toggle).toHaveAccessibleName('Open sidebar')
  const closedPanel = (await panel.boundingBox())!
  const closedButton = (await toggle.boundingBox())!

  await page.emulateMedia({ reducedMotion: 'no-preference' })

  return {
    panelClosedX: closedPanel.x,
    panelOpenX: openPanel.x,
    buttonClosedX: closedButton.x,
    buttonOpenX: openButton.x,
  }
}

/**
 * Samples, via `requestAnimationFrame`, both the panel's and the button's
 * own leading (left) edge on every frame for ~450ms starting the instant
 * the toggle is clicked (340ms transition + margin), and converts each to
 * a progress fraction (0 = closed, 1 = open) against the `endpoints`
 * `measureEndpoints` already measured for real.
 */
async function sampleProgress(
  page: Page,
  endpoints: Endpoints,
): Promise<{ t: number; panelProgress: number; buttonProgress: number }[]> {
  return page.evaluate((endpoints) => {
    return new Promise<{ t: number; panelProgress: number; buttonProgress: number }[]>(
      (resolve) => {
        const panel = document.querySelector('aside[aria-label="Documents"]')
        const button = document.querySelector('button.sidebar-toggle')
        if (!panel || !button) return resolve([])

        const { panelClosedX, panelOpenX, buttonClosedX, buttonOpenX } = endpoints
        const samples: { t: number; panelProgress: number; buttonProgress: number }[] = []
        const start = performance.now()
        function tick() {
          const t = performance.now() - start
          const panelX = panel!.getBoundingClientRect().left
          const buttonX = button!.getBoundingClientRect().left
          samples.push({
            t,
            panelProgress: (panelX - panelClosedX) / (panelOpenX - panelClosedX),
            buttonProgress: (buttonX - buttonClosedX) / (buttonOpenX - buttonClosedX),
          })
          if (t < 450) {
            requestAnimationFrame(tick)
          } else {
            resolve(samples)
          }
        }
        requestAnimationFrame(tick)
      },
    )
  }, endpoints)
}

/**
 * What the two progress fractions can actually be held to — not "identical
 * on every frame" for the same reason `sidebar-transition.spec.ts`'s
 * predecessor gave (git history): both properties animate on the
 * compositor now (`transform` only, on both the panel and the button — no
 * `width` in this mechanism at all any more), so there is less cross-
 * thread skew than the old width-vs-transform pairing had, but frame
 * scheduling under a loaded CI machine (this suite runs alongside nine
 * other browsers) still isn't perfectly deterministic frame-to-frame.
 * Distribution bounds over the mid-flight frames, not a per-frame bound —
 * see the file-level comment for why "progress fraction", not "edge
 * position", is the right thing to compare here at all.
 */
function expectProgressTracks(
  samples: { t: number; panelProgress: number; buttonProgress: number }[],
): void {
  const midFlight = samples.filter((s) => s.t > 40 && s.t < 300)
  expect(midFlight.length, 'frames landed mid-transition').toBeGreaterThan(3)

  const deltas = midFlight
    .map((s) => Math.abs(s.panelProgress - s.buttonProgress))
    .sort((a, b) => a - b)
  const median = deltas[Math.floor(deltas.length / 2)]
  const worst = deltas[deltas.length - 1]

  // Progress fraction is unitless (0 = fully closed, 1 = fully open) — a
  // delta of 0.08 is 8% of either element's own travel range, comfortably
  // above what compositor-frame jitter alone produces but far below what a
  // genuinely desynced pairing (e.g. two different durations, or one
  // element idling while the other moves) would show, which pins the
  // delta near 1.0 for most of the transition rather than near 0.
  expect(median, `median |Δprogress| across ${deltas.length} mid-flight frames`).toBeLessThan(0.08)
  expect(worst, 'worst mid-flight |Δprogress|').toBeLessThan(0.25)
}

test.describe('the toggle travels WITH the panel, not separately', () => {
  test('opening (docked right, the default): button progress tracks panel progress throughout', async ({
    page,
  }) => {
    await page.goto('/')
    // `measureEndpoints` leaves the drawer closed, motion restored — ready
    // for a clean, sampled OPEN transition.
    const endpoints = await measureEndpoints(page, 'right')

    const samplesPromise = sampleProgress(page, endpoints)
    await toggleLocator(page).click()
    const samples = await samplesPromise

    expectProgressTracks(samples)
  })

  test('closing (docked right, the default): button progress tracks panel progress throughout', async ({
    page,
  }) => {
    await page.goto('/')
    const endpoints = await measureEndpoints(page, 'right')
    // `measureEndpoints` leaves the drawer closed — one unsampled click
    // gets back to open, so the SAMPLED click below is a clean close.
    await toggleLocator(page).click()
    await expect(toggleLocator(page)).toHaveAccessibleName('Close sidebar')

    const samplesPromise = sampleProgress(page, endpoints)
    await toggleLocator(page).click()
    const samples = await samplesPromise

    expectProgressTracks(samples)
  })

  test('docked LEFT: the same tracking holds, mirrored — not a right-side-only guarantee', async ({
    page,
  }) => {
    await page.goto('/')
    const endpoints = await measureEndpoints(page, 'left')
    await expect(panelLocator(page)).toHaveClass(/border-r/)

    const samplesPromise = sampleProgress(page, endpoints)
    await toggleLocator(page).click()
    const samples = await samplesPromise

    expectProgressTracks(samples)
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
        if (performance.now() - start < 450) {
          requestAnimationFrame(tick)
        } else {
          resolve(widths)
        }
      }
      requestAnimationFrame(tick)
    })
  })
  await toggleLocator(page).click()
  const samples = await samplesPromise

  expect(samples.length).toBeGreaterThan(3)
  const first = samples[0]
  for (const width of samples) {
    // Sub-pixel layout rounding tolerance only — the button's box must stay
    // effectively constant, never reflowing to a different size mid-slide.
    expect(Math.abs(width - first)).toBeLessThan(1)
  }
})

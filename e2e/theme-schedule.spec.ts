import { test, expect, type Page } from '@playwright/test'

/**
 * "Schedule" theme mode (`features/settings/model/theme.ts`,
 * `features/settings/lib/themeSchedule.ts`) — a fourth mode alongside
 * light/dark/system, resolved against two persisted clock times
 * (`markdown-editor:schedule-light-time`/`-dark-time`, default '07:00'/
 * '19:00' — an overnight-spanning dark window, used as-is by several tests
 * below rather than setting the inputs every time).
 *
 * Every test that cares about a specific time of day uses `page.clock`
 * (installed BEFORE navigation, so both the anti-flash inline script in
 * index.html AND the app's own post-hydration scheduler in `model/
 * theme.ts` observe the exact same fake `Date`/`setTimeout`) rather than
 * waiting on the real clock — this is what lets the "boundary passes while
 * the app is open" tests run in milliseconds instead of hours, and is a
 * genuine controllable-clock injection, not a real-time wait dressed up.
 */

async function openApp(page: Page): Promise<void> {
  await page.goto('/')
  await page.locator('.cm-content').waitFor()
}

async function openSettingsAppearance(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'Appearance' }).click()
}

async function closeSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Close settings' }).click()
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden()
}

function resolvedTheme(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.getAttribute('data-theme'))
}

/** Sets `markdown-editor:theme` to 'schedule' (and, optionally, the two
 * switch times) directly in localStorage — used by tests that care about
 * the RESULT of being in schedule mode at a given time, not about driving
 * the Settings UI to get there (that path is covered separately below).
 * Must run against an already-loaded page (an established origin) before
 * the `page.reload()` whose anti-flash script should observe it. */
async function setScheduleStorage(
  page: Page,
  options?: { lightTime?: string; darkTime?: string },
): Promise<void> {
  await page.evaluate((opts) => {
    localStorage.setItem('markdown-editor:theme', 'schedule')
    if (opts?.lightTime) localStorage.setItem('markdown-editor:schedule-light-time', opts.lightTime)
    if (opts?.darkTime) localStorage.setItem('markdown-editor:schedule-dark-time', opts.darkTime)
  }, options)
}

/** Installed before the reload whose first paint is under test — records
 * every distinct value `data-theme` is ever set to, from the very first
 * script executed on the page (this init script runs before the anti-
 * flash script itself). A "flash of the wrong theme then a correction" is
 * exactly two-or-more distinct recorded values; a clean, correct-from-the-
 * first-paint load is exactly one. */
async function installThemeAttributeRecorder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const history: string[] = []
    ;(window as unknown as { __themeAttrHistory: string[] }).__themeAttrHistory = history
    const record = () => {
      const value = document.documentElement?.getAttribute('data-theme') ?? null
      if (value !== null && history[history.length - 1] !== value) history.push(value)
    }
    // `document.documentElement` does not exist yet at the moment an init
    // script runs (it executes before the HTML parser has created
    // `<html>`) — observing it directly throws. `document` itself (the
    // Document node) always exists; `subtree: true` keeps the observer
    // watching descendants added later, including `<html>` itself once it
    // exists and its `data-theme` attribute once the anti-flash script
    // sets it — regardless of whether that happens via `.setAttribute()`
    // or `.dataset.theme = ...` (both produce the same observable
    // attribute mutation at the DOM level, which is what a
    // `MutationObserver` actually watches for).
    new MutationObserver(record).observe(document, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-theme'],
    })
  })
}

async function themeAttrHistory(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as unknown as { __themeAttrHistory: string[] }).__themeAttrHistory,
  )
}

test.describe('theme schedule — resolves correctly on load, no flash', () => {
  test('daytime (default light/dark window): resolves light with a single, correct paint', async ({
    page,
  }) => {
    await page.clock.install({ time: new Date(2024, 0, 15, 12, 0, 0) })
    await openApp(page)
    await setScheduleStorage(page)
    await installThemeAttributeRecorder(page)

    await page.reload()
    await page.locator('.cm-content').waitFor()

    // `expect.poll` for the resolved value (tolerates the app's reactive
    // wiring taking a beat to settle under a heavily loaded parallel test
    // run) but a plain, immediate `expect` for the history — polling would
    // only ever wait, never erase an already-recorded intermediate value,
    // so "settled correctly, eventually" and "never showed a wrong value
    // along the way" are two genuinely separate claims, both proven here.
    await expect.poll(() => resolvedTheme(page), { timeout: 10_000 }).toBe('light')
    expect(await themeAttrHistory(page)).toEqual(['light'])
  })

  test('night (default overnight dark window, after midnight): resolves dark with a single, correct paint', async ({
    page,
  }) => {
    await page.clock.install({ time: new Date(2024, 0, 15, 0, 30, 0) })
    await openApp(page)
    await setScheduleStorage(page)
    await installThemeAttributeRecorder(page)

    await page.reload()
    await page.locator('.cm-content').waitFor()

    await expect.poll(() => resolvedTheme(page), { timeout: 10_000 }).toBe('dark')
    expect(await themeAttrHistory(page)).toEqual(['dark'])
  })

  test('night (default overnight dark window, before midnight): resolves dark with a single, correct paint', async ({
    page,
  }) => {
    await page.clock.install({ time: new Date(2024, 0, 15, 23, 30, 0) })
    await openApp(page)
    await setScheduleStorage(page)
    await installThemeAttributeRecorder(page)

    await page.reload()
    await page.locator('.cm-content').waitFor()

    await expect.poll(() => resolvedTheme(page), { timeout: 10_000 }).toBe('dark')
    expect(await themeAttrHistory(page)).toEqual(['dark'])
  })

  test('equal light/dark times always resolve dark, regardless of the hour', async ({ page }) => {
    await page.clock.install({ time: new Date(2024, 0, 15, 15, 0, 0) })
    await openApp(page)
    await setScheduleStorage(page, { lightTime: '10:00', darkTime: '10:00' })
    await installThemeAttributeRecorder(page)

    await page.reload()
    await page.locator('.cm-content').waitFor()

    await expect.poll(() => resolvedTheme(page), { timeout: 10_000 }).toBe('dark')
    expect(await themeAttrHistory(page)).toEqual(['dark'])
  })
})

test.describe('theme schedule — applies live while the app stays open', () => {
  test('crossing the light boundary (07:00) flips the theme with no reload', async ({ page }) => {
    // 2 seconds before the default light-starts time.
    //
    // `pauseAt` immediately, before any setup runs. `install()` alone does
    // NOT freeze the clock — it keeps ticking along with real time (probed:
    // ~0.24s of drift across a fast `goto` + `reload`). With only a 2-second
    // margin to the boundary, any run where the setup below took longer than
    // that in REAL time — a loaded machine, a parallel worker, a slow
    // reload — sailed past 07:00 before the assertion, and the app then
    // correctly resolved 'light' while the test still demanded 'dark'. That
    // failed for the one reason a test never should: the product was right.
    // Pausing here pins the clock at 06:59:58 no matter how long setup
    // takes, so the ONLY thing that ever moves it is this test's own
    // explicit `pauseAt` past the boundary further down.
    const beforeBoundary = new Date(2024, 0, 15, 6, 59, 58)
    await page.clock.install({ time: beforeBoundary })
    await page.clock.pauseAt(beforeBoundary)
    await openApp(page)
    await setScheduleStorage(page)
    await page.reload()
    await page.locator('.cm-content').waitFor()
    // `expect.poll`, not a single `expect()` — same reasoning as the
    // post-boundary check below: under a heavily parallel full-suite run,
    // the app's own reactive wiring can take a beat longer than usual to
    // settle after `.cm-content` first appears, even though the resolved
    // value itself is never actually in doubt once it does.
    await expect.poll(() => resolvedTheme(page), { timeout: 10_000 }).toBe('dark')

    // Pause the fake clock exactly past the boundary — the app's own
    // scheduler (a `setTimeout` armed for exactly this instant, see
    // `model/theme.ts`'s `armScheduleTimer`) fires under the mocked
    // timers, with no real waiting and no reload. `pauseAt` (not
    // `fastForward`) — it explicitly settles the clock AT the given
    // instant and fires everything due by then, which is the more
    // literal match for "the boundary passes" than jumping an arbitrary
    // duration forward.
    await page.clock.pauseAt(new Date(2024, 0, 15, 7, 0, 1))

    // A generous explicit timeout (well above the suite's 5s default) —
    // this only has to wait out the real wall-clock time for the browser
    // to actually execute the fired timer callback and repaint, but under
    // a heavily parallel full-suite run that can occasionally take longer
    // than a few seconds of real time on a loaded machine even though
    // nothing is actually stuck.
    await expect.poll(() => resolvedTheme(page), { timeout: 30_000 }).toBe('light')
  })

  test('crossing the dark boundary (19:00) flips the theme with no reload', async ({ page }) => {
    // Paused at install for the same reason as the light-boundary test
    // above — see its comment for the drift measurement.
    const beforeBoundary = new Date(2024, 0, 15, 18, 59, 58)
    await page.clock.install({ time: beforeBoundary })
    await page.clock.pauseAt(beforeBoundary)
    await openApp(page)
    await setScheduleStorage(page)
    await page.reload()
    await page.locator('.cm-content').waitFor()
    await expect.poll(() => resolvedTheme(page), { timeout: 10_000 }).toBe('light')

    await page.clock.pauseAt(new Date(2024, 0, 15, 19, 0, 1))

    await expect.poll(() => resolvedTheme(page), { timeout: 30_000 }).toBe('dark')
  })

  test('crossing midnight inside the overnight dark window stays dark the whole way through', async ({
    page,
  }) => {
    await page.clock.install({ time: new Date(2024, 0, 15, 23, 59, 55) })
    await openApp(page)
    await setScheduleStorage(page)
    await page.reload()
    await page.locator('.cm-content').waitFor()
    expect(await resolvedTheme(page)).toBe('dark')

    // Past midnight, still well inside the dark window (dark until 07:00).
    await page.clock.fastForward(10_000)

    expect(await resolvedTheme(page)).toBe('dark')
  })
})

test.describe('theme schedule — Settings UI', () => {
  test('the theme control exposes all four modes, and Schedule can be picked directly', async ({
    page,
  }) => {
    await openApp(page)
    await openSettingsAppearance(page)

    const group = page.getByRole('group', { name: 'Theme' })
    await expect(group.getByRole('button', { name: 'Light' })).toBeVisible()
    await expect(group.getByRole('button', { name: 'Dark' })).toBeVisible()
    await expect(group.getByRole('button', { name: 'System' })).toBeVisible()
    const scheduleButton = group.getByRole('button', { name: 'Schedule' })
    await expect(scheduleButton).toBeVisible()
    await expect(scheduleButton).toHaveAttribute('aria-pressed', 'false')

    await scheduleButton.click()
    await expect(scheduleButton).toHaveAttribute('aria-pressed', 'true')
    // The "no effect until you switch to Schedule" caption disappears once
    // it's actually selected.
    await expect(page.getByText('so this has no visible effect')).toHaveCount(0)
  })

  test('the two switch times are settable and persist across reload', async ({ page }) => {
    await openApp(page)
    await openSettingsAppearance(page)

    const lightInput = page.locator('input[aria-label="Light theme start time"]')
    const darkInput = page.locator('input[aria-label="Dark theme start time"]')
    await lightInput.fill('06:30')
    await darkInput.fill('20:15')
    await closeSettings(page)

    await page.reload()
    await page.locator('.cm-content').waitFor()
    await openSettingsAppearance(page)

    await expect(page.locator('input[aria-label="Light theme start time"]')).toHaveValue('06:30')
    await expect(page.locator('input[aria-label="Dark theme start time"]')).toHaveValue('20:15')
  })

  test('ThemeToggle cycles through all four modes, ending back at light', async ({ page }) => {
    await openApp(page)
    // Force a known starting point rather than trusting whatever the
    // default happens to resolve to on this machine's OS preference.
    await page.evaluate(() => localStorage.setItem('markdown-editor:theme', 'light'))
    await page.reload()
    await page.locator('.cm-content').waitFor()

    // The theme cycle is a row inside the "…" menu now, not a standalone
    // button in the documents panel's tools row — so the menu has to be
    // opened first. It is opened ONCE for all four clicks on purpose: that
    // row deliberately leaves the popover open when clicked (see
    // `ThemeToggle.vue`'s comment on why it is the one exception among its
    // siblings), and cycling all the way round without the menu closing
    // underneath is exactly the behaviour worth pinning down here.
    await page.getByRole('button', { name: 'More actions' }).click()

    const toggle = page.getByRole('menuitem', {
      name: /Switch to (dark|system|schedule|light) theme/,
    })
    await expect(toggle).toHaveAttribute('aria-label', 'Switch to dark theme')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-label', 'Switch to system theme')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-label', 'Switch to schedule theme')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-label', 'Switch to light theme')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-label', 'Switch to dark theme')
  })

  test('"Reset to defaults" restores the theme mode and both switch times', async ({ page }) => {
    await openApp(page)
    await openSettingsAppearance(page)

    await page
      .getByRole('group', { name: 'Theme' })
      .getByRole('button', { name: 'Schedule' })
      .click()
    await page.locator('input[aria-label="Light theme start time"]').fill('05:00')
    await page.locator('input[aria-label="Dark theme start time"]').fill('21:00')

    await page.getByRole('button', { name: 'Reset to defaults' }).click()
    await page.getByRole('button', { name: 'Reset', exact: true }).click()

    await expect(
      page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'System' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('input[aria-label="Light theme start time"]')).toHaveValue('07:00')
    await expect(page.locator('input[aria-label="Dark theme start time"]')).toHaveValue('19:00')
  })
})

import { test, expect, type Page } from '@playwright/test'

/**
 * Real-browser proof that level 63 — the derived point at which dimmed text
 * stops meeting WCAG AA — clears 4.5:1 in every one of the four theme x
 * soft-contrast combinations, measured against ACTUAL rendered
 * pixels in a real Chromium tab rather than the formula the constant's own
 * doc comment (and `shared/lib/focusDimColor.test.ts`'s unit tests) already
 * derive it from — a genuine computed-style read of
 * `getComputedStyle(...).color` against the editor's own rendered
 * background, not a re-statement of the arithmetic.
 *
 * 63 is deliberately NOT the slider's minimum. That is 10: focus mode exists
 * to push surrounding text out of attention, and it is a reversible personal
 * preference rather than published content, so it is not held to a floor
 * written for readers who cannot restyle what they are given (see
 * `FOCUS_DIM_LEVEL_MIN`'s own comment). What this spec pins is the level a
 * user can return to when they do want the dimmed text to stay AA-legible —
 * a fact worth keeping true, just no longer a limit.
 *
 * Theme/`data-soft` are set via `localStorage` (matching the keys
 * `features/settings/model/theme.ts`/`softContrast.ts` themselves write)
 * and then the page is FULLY RELOADED before any measurement — both are read
 * once at module-eval time by `src/index.html`'s anti-flash inline script
 * and by this app's Effector stores, so setting them after the page has
 * already booted would leave the current render stale even though the
 * storage value changed underneath it.
 */

const THEME_KEY = 'markdown-editor:theme'
const SOFT_CONTRAST_KEY = 'markdown-editor:soft-contrast'
const FOCUS_MODE_ENABLED_KEY = 'markdown-editor:focus-mode-enabled'
const FOCUS_DIM_LEVEL_KEY = 'markdown-editor:focus-dim-level'

const AA_THRESHOLD_DIM_LEVEL = 63

const COMBINATIONS: ReadonlyArray<{
  label: string
  theme: 'light' | 'dark'
  soft: boolean
}> = [
  { label: 'light', theme: 'light', soft: false },
  { label: 'light+soft', theme: 'light', soft: true },
  { label: 'dark', theme: 'dark', soft: false },
  { label: 'dark+soft', theme: 'dark', soft: true },
]

async function primeAndReload(
  page: Page,
  theme: 'light' | 'dark',
  soft: boolean,
  dimLevel: number,
): Promise<void> {
  await page.goto('/')
  await page.evaluate(
    ({ themeKey, softKey, focusKey, levelKey, theme, soft, dimLevel }) => {
      localStorage.setItem(themeKey, theme)
      localStorage.setItem(softKey, String(soft))
      localStorage.setItem(focusKey, 'true')
      localStorage.setItem(levelKey, String(dimLevel))
    },
    {
      themeKey: THEME_KEY,
      softKey: SOFT_CONTRAST_KEY,
      focusKey: FOCUS_MODE_ENABLED_KEY,
      levelKey: FOCUS_DIM_LEVEL_KEY,
      theme,
      soft,
      dimLevel,
    },
  )
  await page.reload()
  await page.locator('.cm-content').waitFor()
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
  if (soft) {
    await expect(page.locator('html')).toHaveAttribute('data-soft', 'true')
  }
}

// Handles both computed-style forms Chromium hands back in this suite: the
// legacy `rgb(r, g, b)` (0-255) the plain `--color-base-100` background
// serializes as, and `color(srgb r g b)` (channels 0-1) — what a
// `color-mix()` result (the dimmed line's actual colour) serializes as. Same
// reasoning as `focus-mode.spec.ts`'s own `normalizedColor` helper.
function parseRgb(value: string): [number, number, number] {
  const legacy = value.match(/^rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/)
  if (legacy) return [Number(legacy[1]), Number(legacy[2]), Number(legacy[3])]
  const modern = value.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/)
  if (modern) {
    return [Number(modern[1]) * 255, Number(modern[2]) * 255, Number(modern[3]) * 255]
  }
  throw new Error(`Unrecognized colour: ${value}`)
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const cs = c / 255
    return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

test.describe('focus dim level — real-browser contrast at the AA threshold', () => {
  for (const { label, theme, soft } of COMBINATIONS) {
    test(`clears 4.5:1 at the AA threshold level (${AA_THRESHOLD_DIM_LEVEL}%) — ${label}`, async ({
      page,
    }) => {
      await primeAndReload(page, theme, soft, AA_THRESHOLD_DIM_LEVEL)

      await page.locator('.cm-content').click()
      await page.keyboard.press('Control+a')
      await page.keyboard.press('Delete')
      // Cursor ends up at the end of the inserted text (inside "two"), so
      // line 1 ("one") is outside the active paragraph and gets dimmed.
      await page.keyboard.insertText('one\n\ntwo')

      const dimmedLine = page.locator('.cm-content .cm-line').first()
      await expect(dimmedLine).toHaveClass(/cm-focus-dim/)

      const dimColor = await dimmedLine.evaluate((el) => getComputedStyle(el).color)
      // The editor's own rendered background — `daisyEditorTheme` in
      // `features/editor/lib/theme.ts` paints `.cm-editor` with
      // `var(--color-base-100)` directly, so reading it back here measures
      // the ACTUAL composited background for this theme/soft combination
      // rather than a hardcoded hex that could drift from `main.css`.
      const bgColor = await page
        .locator('.cm-editor')
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor)

      const ratio = contrastRatio(parseRgb(dimColor), parseRgb(bgColor))
      expect(ratio, `${label}: dim ${dimColor} vs background ${bgColor}`).toBeGreaterThanOrEqual(
        4.5,
      )
    })
  }
})

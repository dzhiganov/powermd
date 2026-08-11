import { existsSync, statSync } from 'node:fs'

import { test, expect } from '@playwright/test'

// Screenshots time out in the CDP-attached browser pane used for manual
// verification this session — this proves the same capture succeeds, and
// lands on disk, in a real Playwright-driven tab.
test('captures a screenshot to an artifact path', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.locator('.cm-content').waitFor()

  // Wait for the PREVIEW, not just the editor. Waiting only on `.cm-content`
  // captured the app mid-boot: editor full of text, preview pane blank,
  // status bar reading "0 words · 0 characters" — because the preview
  // renders in a worker and had not delivered its first result yet. Nothing
  // was broken, but a screenshot is read by eye, and that one looked exactly
  // like a serious bug. A capture whose timing has to be explained is worse
  // than no capture. (`first-paint.spec.ts` asserts the same population as
  // behaviour, rather than leaving it implied by a picture.)
  await page.locator('.markdown-preview h1, .markdown-preview p').first().waitFor()

  // `testInfo.outputPath` places this under Playwright's own per-test
  // `test-results/` directory (gitignored, cleaned between runs) rather
  // than a hand-picked path, so parallel test runs can never collide on
  // the same file.
  const screenshotPath = testInfo.outputPath('app.png')
  await page.screenshot({ path: screenshotPath })

  expect(existsSync(screenshotPath)).toBe(true)
  expect(statSync(screenshotPath).size).toBeGreaterThan(0)
})

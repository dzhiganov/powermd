import { test, expect } from '@playwright/test'

// Real typing, not a synthetic value assignment: `.cm-content` is
// CodeMirror's own `contentEditable` surface, which only reacts to genuine
// input events. `page.keyboard.type` dispatches a full `keydown`/
// `keypress`/`input`/`keyup` sequence per character over CDP — the same
// path a real user's typing takes, and the thing the CDP-attached browser
// pane's synthetic event dispatch kept getting wrong during manual
// verification this session.
test('typing into the CodeMirror editor updates the rendered preview', async ({ page }) => {
  await page.goto('/')

  const editorContent = page.locator('.cm-content')
  await editorContent.click()
  await page.keyboard.press('Control+a')

  const marker = `Playwright smoke ${Date.now()}`
  await page.keyboard.type(`## ${marker}\n\nReal key events reached the editor.`)

  // The preview renders off the main thread on a 150ms debounce (see
  // src/features/preview/model/preview.ts) — `toContainText`/`toBeVisible`
  // retry until the debounce and the worker round-trip land, so no
  // arbitrary sleep is needed here.
  await expect(page.locator('.markdown-preview')).toContainText(marker)
  await expect(page.locator('.markdown-preview h2', { hasText: marker })).toBeVisible()
})

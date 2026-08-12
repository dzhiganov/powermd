import { test, expect, type Page, type Locator } from '@playwright/test'

/**
 * Real clicks throughout (`locator.click()` on the rendered `<input>`),
 * never a synthetic `checked =` assignment or a direct effector event
 * call — the point of this suite is to prove the *whole* wire: a browser
 * click on the preview's checkbox reaches `src/app/taskListToggle.ts`,
 * which reaches `editor/model/taskList.ts`, which dispatches a real
 * CodeMirror transaction, which flows back out through `contentChanged`
 * into the store the editor's own `.cm-content` renders from. Same
 * "drive it the way a user would" reasoning as
 * `wiki-link-completion.spec.ts`'s own doc comment.
 */

async function openApp(page: Page): Promise<void> {
  await page.goto('/')
  await page.locator('.cm-content').waitFor()
}

async function clearEditor(page: Page): Promise<void> {
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Delete')
}

/**
 * Seeds the editor with `markdown`, via `page.keyboard.insertText` rather
 * than `.type()` — deliberately. `.type()` sends a real `keydown` per
 * character, and this project's `markdown()` language extension binds
 * `Enter` (at `Prec.high`, see `@codemirror/lang-markdown`'s
 * `markdownKeymap`) to `insertNewlineContinueMarkup`, which auto-inserts
 * a fresh list marker on the new line — exactly what a real typed `\n`
 * inside a `- [ ] one\n- [ ] two` string would trigger, corrupting this
 * setup step into `- [ ] one\n- - [ ] two`. `insertText` dispatches a
 * plain input event (the same path a paste takes), never a `keydown`, so
 * the multi-line markdown lands byte-for-byte with no keymap involved.
 * The checkbox *click* every test actually exercises afterward is still
 * driven for real (see this file's own doc comment) — this only sidesteps
 * the auto-continuation for the unrelated job of getting text in.
 *
 * `markdown` should have no trailing newline — a trailing `\n` would
 * leave a blank final line, which every `.cm-content` `toHaveText`
 * assertion below would then have to account for. Waits for the
 * debounced preview render to produce at least one checkbox before
 * returning, so every caller can click one immediately.
 */
async function setEditorContent(page: Page, markdown: string): Promise<void> {
  await clearEditor(page)
  await page.keyboard.insertText(markdown)
  await expect(page.locator('.markdown-preview .task-list-checkbox').first()).toBeVisible()
}

function checkboxes(page: Page): Locator {
  return page.locator('.markdown-preview .task-list-checkbox')
}

function editorText(page: Page): Locator {
  return page.locator('.cm-content')
}

/**
 * The full document text, one string per source line joined by `\n`.
 * `.cm-content`'s DOM is one `<div class="cm-line">` per line with no
 * text node between them, so `Locator#textContent()`/Playwright's
 * `toHaveText` (both read `element.textContent`, which never inserts a
 * separator between sibling elements) collapse every line together with
 * no `\n` at all — this reads each `.cm-line` individually instead and
 * joins them the same way `toggleTaskListItem`'s own `source.split('\n')`
 * would expect. Used through `expect.poll` (not a plain `await`) so
 * multi-line assertions retry the same way a single-line
 * `expect(locator).toHaveText(...)` already does — the toggle's document
 * change lands asynchronously (through effector, not synchronously with
 * the click), so a bare one-shot read could observe stale text.
 */
function getEditorLines(page: Page): Promise<string> {
  return page
    .locator('.cm-content .cm-line')
    .allTextContents()
    .then((lines) => lines.join('\n'))
}

test.describe('preview task-list checkbox', () => {
  test('clicking an unchecked box checks it and the markdown reads "- [x]"', async ({ page }) => {
    await openApp(page)
    await setEditorContent(page, '- [ ] buy milk')

    const checkbox = checkboxes(page).first()
    await expect(checkbox).not.toBeChecked()

    await checkbox.click()

    await expect(checkbox).toBeChecked()
    await expect(editorText(page)).toHaveText('- [x] buy milk')
  })

  test('clicking again unchecks it', async ({ page }) => {
    await openApp(page)
    await setEditorContent(page, '- [x] buy milk')

    const checkbox = checkboxes(page).first()
    await expect(checkbox).toBeChecked()

    await checkbox.click()

    await expect(checkbox).not.toBeChecked()
    await expect(editorText(page)).toHaveText('- [ ] buy milk')
  })

  test('with several task items, the correct one changes and the others do not', async ({
    page,
  }) => {
    await openApp(page)
    await setEditorContent(page, '- [ ] first\n- [ ] second\n- [ ] third')

    await expect(checkboxes(page)).toHaveCount(3)
    await checkboxes(page).nth(1).click()

    await expect(checkboxes(page).nth(0)).not.toBeChecked()
    await expect(checkboxes(page).nth(1)).toBeChecked()
    await expect(checkboxes(page).nth(2)).not.toBeChecked()
    await expect.poll(() => getEditorLines(page)).toBe('- [ ] first\n- [x] second\n- [ ] third')
  })

  test('a nested task list toggles the right item', async ({ page }) => {
    await openApp(page)
    await setEditorContent(page, '- [ ] outer\n  - [ ] inner one\n  - [ ] inner two')

    await expect(checkboxes(page)).toHaveCount(3)
    // The rendered order is depth-first: outer, then its two children.
    await checkboxes(page).nth(2).click()

    await expect(checkboxes(page).nth(0)).not.toBeChecked()
    await expect(checkboxes(page).nth(1)).not.toBeChecked()
    await expect(checkboxes(page).nth(2)).toBeChecked()
    await expect
      .poll(() => getEditorLines(page))
      .toBe('- [ ] outer\n  - [ ] inner one\n  - [x] inner two')
  })

  test("does not move the editor's cursor", async ({ page }) => {
    await openApp(page)
    await setEditorContent(page, '- [ ] first\n- [ ] second\n- [ ] third')

    // Place the caret in the middle of the *second* line's text — after
    // "- [ ] se", before "cond" — via keyboard navigation from a known
    // start, not a mouse click (a click's exact pixel-to-offset mapping
    // isn't the thing under test here).
    await editorText(page).click()
    await page.keyboard.press('Control+Home')
    await page.keyboard.press('ArrowDown')
    for (let i = 0; i < '- [ ] se'.length; i += 1) {
      await page.keyboard.press('ArrowRight')
    }

    // Toggle a *different* line's checkbox in the preview. Clicking it
    // moves DOM focus off `.cm-content` onto the checkbox — CodeMirror
    // reasserts its own `state.selection` back into the DOM the next time
    // its content element regains focus (the same mechanism
    // `useCodeMirror.ts`'s `forceSpellcheckRescan` relies on), so
    // refocusing without clicking (`.focus()`, not `.click()`) and then
    // typing is what proves the underlying selection — not just the
    // screen's last-drawn caret — survived the toggle untouched.
    await checkboxes(page).nth(2).click()
    await expect(checkboxes(page).nth(2)).toBeChecked()

    await editorText(page).focus()
    await page.keyboard.type('X')

    await expect.poll(() => getEditorLines(page)).toBe('- [ ] first\n- [ ] seXcond\n- [x] third')
  })

  test('undo restores the previous state in one step', async ({ page }) => {
    await openApp(page)
    await setEditorContent(page, '- [ ] buy milk')

    await checkboxes(page).first().click()
    await expect(editorText(page)).toHaveText('- [x] buy milk')
    // Wait for the debounced preview to actually re-render the checked
    // state — confirmed via the `checked` HTML *attribute* specifically
    // (`toBeChecked()` reads the live `.checked` DOM *property*, which the
    // click's own native default action already flipped, independent of
    // any render). Only a genuine `v-html` patch (a fresh parse of the
    // sanitized HTML string) adds the attribute; without waiting for it, an
    // undo fast enough to land inside the same 150ms debounce window as the
    // click would make the debounced source coalesce click+undo into one
    // net-zero render ("- [ ] buy milk" both before and after) — which
    // Effector's store (comparing the two equal strings) treats as no
    // change and never re-patches the DOM at all, leaving the original
    // `<input>` node's already-flipped `.checked` property stuck `true`.
    await expect(checkboxes(page).first()).toHaveAttribute('checked', '')

    await editorText(page).click()
    await page.keyboard.press('Control+z')

    await expect(editorText(page)).toHaveText('- [ ] buy milk')
    await expect(checkboxes(page).first()).not.toBeChecked()
  })

  test('a bare "[]" is never rendered as a checkbox', async ({ page }) => {
    await openApp(page)
    await setEditorContent(page, '- [ ] real task\n- [] not a task')

    // Only the genuine GFM task item gets a checkbox — the bare-bracket
    // line renders as plain list-item text, exactly as GitHub renders it.
    await expect(checkboxes(page)).toHaveCount(1)
    await expect(page.locator('.markdown-preview li', { hasText: 'not a task' })).toContainText(
      '[] not a task',
    )
  })
})

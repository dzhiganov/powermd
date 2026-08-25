import { test, expect, type Page } from '@playwright/test'

/**
 * End-to-end coverage for the bookmarks feature: adding (mouse gutter click
 * AND the Mod-Shift-B keyboard binding), the status bar count, editing a
 * comment/colour through the shared `PopoverMenu`, prev/next navigation,
 * deleting, surviving a reload, and position mapping across a real edit
 * (typing a paragraph above a bookmark).
 *
 * Real interactions throughout — mouse clicks at real gutter coordinates,
 * real keyboard chords — never synthetic effector event calls, same
 * "drive it the way a user would" reasoning as every other spec in this
 * directory. Multi-line seeding goes through `page.keyboard.insertText` in
 * one shot (never `.type()` line by line) — same reasoning as
 * `task-list-checkbox.spec.ts`'s own doc comment: a literal `\n` inside
 * `.type()` risks list/markdown auto-continuation corrupting the seed.
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

async function setEditorContent(page: Page, markdown: string): Promise<void> {
  await clearEditor(page)
  await page.keyboard.insertText(markdown)
}

function bookmarksTrigger(page: Page) {
  return page.locator('button[aria-label^="Bookmarks,"]')
}

function bookmarkMarkers(page: Page) {
  return page.locator('.cm-bookmark-marker')
}

/** Clicks the bookmark gutter at the row aligned with the `.cm-line`
 * containing `text` — the gutter has no per-line locator of its own (it's
 * one CodeMirror-rendered cell per visible line, not individually
 * addressable by content), so this clicks at the gutter's own X and that
 * line's own Y, mirroring exactly where a user's cursor would land. */
async function clickGutterForLineText(page: Page, text: string): Promise<void> {
  const line = page.locator('.cm-content .cm-line', { hasText: text })
  await line.waitFor()
  const lineBox = await line.boundingBox()
  const gutter = page.locator('.cm-bookmark-gutter')
  await gutter.waitFor()
  const gutterBox = await gutter.boundingBox()
  if (lineBox === null || gutterBox === null) throw new Error('missing bounding box')
  await page.mouse.click(gutterBox.x + gutterBox.width / 2, lineBox.y + lineBox.height / 2)
}

async function expectCount(page: Page, label: string): Promise<void> {
  await expect(page.locator(`button[aria-label="Bookmarks, ${label}"]`)).toBeVisible()
}

test.describe('bookmarks', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await setEditorContent(page, 'Line one\nLine two\nLine three')
    await expectCount(page, '0 bookmarks')
  })

  test('clicking the gutter adds a bookmark, updates the status bar count, and is genuinely painted', async ({
    page,
  }) => {
    await clickGutterForLineText(page, 'Line two')

    await expectCount(page, '1 bookmark')
    const marker = bookmarkMarkers(page).first()
    await expect(marker).toBeVisible()

    // Not just positioned — actually painted, with a real hit-testable
    // centre (see this project's own "class name collides with daisyUI"
    // lesson: geometry can pass while the element is invisible/inert).
    const opacity = await marker.evaluate((el) => Number(getComputedStyle(el).opacity))
    expect(opacity).toBeGreaterThan(0)
    const box = await marker.boundingBox()
    if (box === null) throw new Error('marker has no box')
    const hitsSelf = await page.evaluate(
      ({ x, y }) =>
        document.elementFromPoint(x, y)?.classList.contains('cm-bookmark-marker') ?? false,
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    )
    expect(hitsSelf).toBe(true)
  })

  test('Alt-Shift-B adds a bookmark on the cursor line without a mouse, and toggles it off again', async ({
    page,
  }) => {
    const line = page.locator('.cm-content .cm-line', { hasText: 'Line two' })
    await line.click()

    // Not Control+Shift+B — that's Chrome's own "toggle bookmarks bar"
    // shortcut, which this app deliberately avoids colliding with (see
    // `lib/shortcuts.ts`'s own comment on `Alt-Shift-b`).
    await page.keyboard.press('Alt+Shift+B')
    await expectCount(page, '1 bookmark')

    // Creating a bookmark auto-opens the popover and moves focus into it
    // (see `BookmarksIndicator.vue`'s `bookmarkEditorOpenRequested`
    // handler) — the editor's own keymap only fires while its content has
    // focus (`lib/shortcuts.ts`'s own doc comment), so the second chord has
    // to land back on the editor first, same as a real user would close the
    // popup and click back in before continuing.
    await page.keyboard.press('Escape')
    await line.click()

    // Same chord on the same line removes it — the keyboard-only add/remove
    // toggle (see `bookmarkToggleAtCursorRequested`'s own doc comment).
    await page.keyboard.press('Alt+Shift+B')
    await expectCount(page, '0 bookmarks')
  })

  test('a new bookmark opens the popover, ready to comment', async ({ page }) => {
    await clickGutterForLineText(page, 'Line one')

    await expect(page.getByRole('menu', { name: 'Bookmarks' })).toBeVisible()
    const commentBox = page.getByRole('textbox', { name: /^Comment for bookmark 1$/ })
    await expect(commentBox).toBeVisible()
    await commentBox.fill('Remember this spot')
    await commentBox.blur()

    // Reflected in the row's own label immediately (no reload needed).
    await expect(
      page.getByRole('button', { name: /^Edit bookmark 1, Red, Remember this spot$/ }),
    ).toBeVisible()
  })

  test('recolouring a bookmark updates its label and its gutter marker colour', async ({
    page,
  }) => {
    await clickGutterForLineText(page, 'Line one')
    await page.getByRole('button', { name: 'Amber' }).click()

    await expect(page.getByRole('button', { name: /^Edit bookmark 1, Amber/ })).toBeVisible()

    const marker = bookmarkMarkers(page).first()
    const color = await marker.evaluate((el) => getComputedStyle(el).backgroundColor)
    // #b3651b -> rgb(179, 101, 27)
    expect(color).toBe('rgb(179, 101, 27)')
  })

  test('deleting a bookmark removes it and updates the count', async ({ page }) => {
    await clickGutterForLineText(page, 'Line one')
    await expectCount(page, '1 bookmark')

    await page.getByRole('button', { name: 'Delete' }).click()

    await expectCount(page, '0 bookmarks')
    await expect(bookmarkMarkers(page)).toHaveCount(0)
  })

  test('next/previous navigation cycles between two bookmarks and moves the cursor', async ({
    page,
  }) => {
    await clickGutterForLineText(page, 'Line one')
    await page.keyboard.press('Escape')
    await clickGutterForLineText(page, 'Line three')
    await page.keyboard.press('Escape')
    await expectCount(page, '2 bookmarks')

    // Cursor currently sits on "Line three" (the just-created bookmark).
    // "Next" wraps around to the first bookmark ("Line one") — proved by
    // typing right after the jump (`jumpToPos` calls `view.focus()`) and
    // checking WHERE the typed character landed, the same "type after
    // refocusing to prove the underlying selection moved" technique
    // `task-list-checkbox.spec.ts`'s own cursor test uses.
    await bookmarksTrigger(page).click()
    await page.getByRole('button', { name: 'Jump to next bookmark' }).click()
    await page.keyboard.type('X')

    await expect
      .poll(() =>
        page
          .locator('.cm-content .cm-line')
          .allTextContents()
          .then((lines) => lines.join('\n')),
      )
      .toBe('XLine one\nLine two\nLine three')
  })

  test('survives a reload: count, comment, and colour all persist', async ({ page }) => {
    await clickGutterForLineText(page, 'Line two')
    const commentBox = page.getByRole('textbox', { name: /^Comment for bookmark 1$/ })
    await commentBox.fill('Survives reload')
    await commentBox.blur()
    await page.getByRole('button', { name: 'Teal' }).click()
    await page.keyboard.press('Escape')
    await expectCount(page, '1 bookmark')

    // The bookmark itself persists immediately (`documents/model
    // /bookmarks.ts`'s `saveBookmarkFx` is not debounced), but the
    // document's CONTENT autosave is (`documents/model/documents.ts`'s
    // `AUTOSAVE_MS`, 500ms) — reloading before that lands would revert the
    // active document back to whatever was last actually written to
    // IndexedDB (the seeded welcome content, in a fresh browser context),
    // which would then make the bookmark's mapped position land on a line
    // CodeMirror hasn't even rendered into the DOM yet (virtualized), and
    // this test's later `.cm-bookmark-marker` assertion would fail for a
    // reason that has nothing to do with bookmarks. Comfortably past the
    // debounce window before reloading avoids that entirely.
    await page.waitForTimeout(700)
    await page.reload()
    await page.locator('.cm-content').waitFor()

    await expectCount(page, '1 bookmark')
    await bookmarksTrigger(page).click()
    await expect(
      page.getByRole('button', { name: /^Edit bookmark 1, Teal, Survives reload$/ }),
    ).toBeVisible()

    const marker = bookmarkMarkers(page).first()
    await expect(marker).toBeVisible()
    const color = await marker.evaluate((el) => getComputedStyle(el).backgroundColor)
    // #2f7f7f -> rgb(47, 127, 127)
    expect(color).toBe('rgb(47, 127, 127)')
  })

  test('typing a paragraph above a bookmark leaves it anchored to the same text', async ({
    page,
  }) => {
    await clickGutterForLineText(page, 'Line two')
    await page.keyboard.press('Escape')
    await expectCount(page, '1 bookmark')

    const markerBefore = bookmarkMarkers(page).first()
    const boxBefore = await markerBefore.boundingBox()
    if (boxBefore === null) throw new Error('marker has no box')

    // Place the cursor at the very start of the document and insert two
    // new lines above everything — a real insert-above edit.
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+Home')
    await page.keyboard.insertText('A brand new first line\nAnother new line\n')

    // The marker is still exactly one, still visible, and now sits next to
    // whatever line contains "Line two" — which has moved two lines down.
    await expect(bookmarkMarkers(page)).toHaveCount(1)
    const targetLine = page.locator('.cm-content .cm-line', { hasText: 'Line two' })
    const targetBox = await targetLine.boundingBox()
    const markerAfter = bookmarkMarkers(page).first()
    const boxAfter = await markerAfter.boundingBox()
    if (targetBox === null || boxAfter === null) throw new Error('missing box after edit')

    // Vertically aligned with "Line two"'s new position, not its old one —
    // a generous tolerance (well under one line height, ~27px at this
    // theme's font size) absorbs the gutter cell's own padding sitting a
    // few pixels off the content line's box, while still clearly
    // distinguishing "the right line" from "one line off".
    expect(Math.abs(boxAfter.y - targetBox.y)).toBeLessThan(15)
    expect(boxAfter.y).toBeGreaterThan(boxBefore.y)

    // And still editable/findable via the popover — comment/colour weren't
    // lost, only the position moved.
    await bookmarksTrigger(page).click()
    await expect(page.getByRole('button', { name: /^Edit bookmark 1,/ })).toBeVisible()
  })

  test('deleting the entire bookmarked line does not delete the bookmark', async ({ page }) => {
    await clickGutterForLineText(page, 'Line two')
    await page.keyboard.press('Escape')
    await expectCount(page, '1 bookmark')

    // Select the whole "Line two" line (including its newline) and delete
    // it outright.
    const line = page.locator('.cm-content .cm-line', { hasText: 'Line two' })
    await line.click()
    await page.keyboard.press('Home')
    await page.keyboard.down('Shift')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.up('Shift')
    await page.keyboard.press('Delete')

    // The bookmark survives — not dropped, per `bookmarkPosition.ts`'s
    // documented "never silently dropped" deletion behaviour.
    await expectCount(page, '1 bookmark')
    await expect(bookmarkMarkers(page)).toHaveCount(1)
  })

  test('creating, recolouring, and deleting a bookmark never enters the undo stack', async ({
    page,
  }) => {
    // A real text edit FIRST, so there is something Ctrl+Z should actually
    // undo — if any bookmark action below had wrongly joined the undo
    // stack, this single Ctrl+Z would restore the bookmark instead of (or
    // in addition to) reverting the text.
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('EDIT')
    await expect
      .poll(() =>
        page
          .locator('.cm-content .cm-line')
          .allTextContents()
          .then((lines) => lines.join('\n')),
      )
      .toBe('Line one\nLine two\nLine threeEDIT')

    // Bookmark actions: create, recolour, edit the comment, delete —
    // none of these are document edits, so none should touch the CodeMirror
    // history the way a real keystroke does.
    await clickGutterForLineText(page, 'Line two')
    await page.getByRole('button', { name: 'Green' }).click()
    const commentBox = page.getByRole('textbox', { name: /^Comment for bookmark 1$/ })
    await commentBox.fill('Temporary')
    await commentBox.blur()
    await page.getByRole('button', { name: 'Delete' }).click()
    await expectCount(page, '0 bookmarks')

    // One Ctrl+Z undoes exactly the "EDIT" text — not a bookmark action,
    // and not a no-op because bookmark actions ate the undo step.
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+z')
    await expect
      .poll(() =>
        page
          .locator('.cm-content .cm-line')
          .allTextContents()
          .then((lines) => lines.join('\n')),
      )
      .toBe('Line one\nLine two\nLine three')
  })
})

test.describe('bookmarks: removed with their document', () => {
  test('deleting a document deletes its bookmarks too', async ({ page }) => {
    await openApp(page)
    // The auto-seeded first-run document's title is derived from
    // `WELCOME_CONTENT`'s own first line ("# Markdown Editor" ->
    // "Markdown Editor") — see `lib/title.ts`'s own doc comment: typing new
    // CONTENT into it (`setEditorContent` below) never renames it, a
    // document's title only ever changes via an explicit rename.
    const documentTitle = 'Markdown Editor'
    await setEditorContent(page, 'Only line')
    await clickGutterForLineText(page, 'Only line')
    await page.keyboard.press('Escape')
    await expectCount(page, '1 bookmark')

    // Create a second, empty document (becomes active) so this one isn't
    // "the last document" when deleted — deleting the last document
    // auto-recreates a fresh empty one instead of leaving the drawer with
    // nothing, which would make "0 bookmarks" ambiguous between "deleted"
    // and "never had any".
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await page.getByRole('menuitem', { name: 'New file' }).click()
    await expectCount(page, '0 bookmarks')

    await page.getByRole('button', { name: `Actions for ${documentTitle}` }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()

    // The still-active new document continues to show zero — proving
    // nothing survived, rather than merely that the count never changed.
    await expectCount(page, '0 bookmarks')
  })
})

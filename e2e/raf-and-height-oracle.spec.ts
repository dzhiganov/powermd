import { test, expect } from '@playwright/test'

// CodeMirror schedules its own internal layout re-measure pass via
// `requestAnimationFrame` (see @codemirror/view's `measureScheduled`
// handling) — the same call `useCodeMirror.ts`'s `document.fonts.ready`
// handler and `ResizeObserver` callback both go through. In the
// CDP-attached browser pane used for manual verification this session
// (`document.hidden === true`), a background/hidden page's rAF callbacks
// are throttled hard enough that they effectively never run, so that
// measure pass never lands and CodeMirror's internal height map — used for
// cursor placement, scroll-into-view, and scroll-sync's proportional
// mapping — stays keyed to its own un-measured fallback instead of the
// real rendered layout. A real, foregrounded Playwright tab has neither
// problem.
test('requestAnimationFrame actually fires in a real tab', async ({ page }) => {
  await page.goto('/')

  expect(await page.evaluate(() => document.hidden)).toBe(false)

  const rafTimestamp = await page.evaluate(
    () => new Promise<number>((resolve) => requestAnimationFrame(resolve)),
  )
  expect(rafTimestamp).toBeGreaterThan(0)
})

test("CodeMirror's height oracle matches the real rendered line height, not a stale fallback", async ({
  page,
}) => {
  await page.goto('/')
  await page.locator('.cm-line').first().waitFor()

  const { blockHeight, computedLineHeight } = await page.evaluate(async () => {
    // `EditorView.findFromDOM` is a real public CodeMirror API (not a test
    // hook added to app source) that resolves a live `EditorView` from its
    // own DOM. The one thing that has to be right for it to find anything
    // is *which* `EditorView` class does the looking: CodeMirror keeps the
    // DOM->view association in a structure private to its own module
    // instance, so a second, independently-bundled copy of
    // `@codemirror/view` would never find the app's real view. Re-importing
    // the *exact* URL the app's own module graph already resolved (found
    // via the Resource Timing entry Vite's dev server left behind, rather
    // than a hardcoded path that would break the moment Vite's dep-cache
    // hash changes) sidesteps that: browsers cache ES modules by resolved
    // URL, so this `import()` returns the very same module namespace
    // object the running app is already using, not a second instance.
    const viewModuleUrl = performance
      .getEntriesByType('resource')
      .map((resource) => resource.name)
      .find((name) => name.includes('/@codemirror_view.js'))
    if (!viewModuleUrl) {
      throw new Error('Could not find the @codemirror/view module URL among loaded resources')
    }

    const module = (await import(viewModuleUrl)) as {
      EditorView: {
        findFromDOM(dom: Element): {
          state: { doc: { line(n: number): { from: number } } }
          lineBlockAt(pos: number): { height: number }
        } | null
      }
    }

    const editorRoot = document.querySelector('.cm-editor')
    if (!editorRoot) throw new Error('No .cm-editor found on the page')
    const view = module.EditorView.findFromDOM(editorRoot)
    if (!view) throw new Error('EditorView.findFromDOM found no view for the current .cm-editor')

    const firstLine = view.state.doc.line(1)
    const block = view.lineBlockAt(firstLine.from)

    const lineEl = document.querySelector('.cm-line')
    if (!lineEl) throw new Error('No .cm-line found on the page')

    return {
      blockHeight: block.height,
      computedLineHeight: parseFloat(getComputedStyle(lineEl).lineHeight),
    }
  })

  expect(computedLineHeight).toBeGreaterThan(0)
  // CodeMirror's un-measured fallback line height is a hardcoded low
  // estimate (measured ~14px in this app before any real measure pass has
  // run), nowhere near this app's actual rendered line height. A stale
  // oracle — the exact failure mode a hidden/backgrounded tab produces —
  // would fail this comparison; the rAF-scheduled measure pass firing is
  // what keeps `lineBlockAt` in sync with the real DOM.
  expect(Math.abs(blockHeight - computedLineHeight)).toBeLessThan(2)
})

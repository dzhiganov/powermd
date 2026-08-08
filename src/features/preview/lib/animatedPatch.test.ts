// @vitest-environment jsdom
//
// The only test file in this project that needs a DOM (`animatedPatch.ts`
// mutates live `Text`/`Element` nodes directly — there's no way to
// exercise `patchChildren`/`patchTextLeaf` against plain data). Vitest's
// per-file `@vitest-environment` pragma scopes that to just this file,
// leaving `vitest.config.ts`'s project-wide `environment: 'node'` (and
// every other, DOM-free test) untouched — see that file's own comment on
// why it's deliberately minimal.
//
// jsdom over happy-dom: this module leans on exact DOM semantics —
// `Node.isEqualNode` deep-comparing attributes and children, `NamedNodeMap`
// iteration order, `ChildNode.after`, text-node splitting — where jsdom's
// broader spec coverage and longer track record matter more than
// happy-dom's faster startup for a single test file. The correctness
// invariant this suite exists to prove (settled DOM byte-identical to a
// fresh render) is exactly the kind of thing a DOM-emulation gap could
// silently falsify, so fidelity was chosen over speed here.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderMarkdown } from './pipeline'
import {
  CLEANUP_DELAY_MS,
  HTML_DIFF_THRESHOLD,
  createAnimatedPreview,
  type AnimatedPreviewController,
} from './animatedPatch'

function stubMatchMedia(matches: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

function createRoot(): HTMLDivElement {
  const root = document.createElement('div')
  document.body.appendChild(root)
  return root
}

/** What a fresh, one-shot render of `source` would put in the live DOM —
 * i.e. exactly the comparison the task's central invariant asks for. Goes
 * through the same `.innerHTML = html` parse+reserialize round trip the
 * animated path's own fallback uses, so any jsdom serialization quirk
 * (attribute quoting, self-closing tags, …) affects both sides equally and
 * can never produce a false mismatch. */
function oneShotHtml(source: string): string {
  const reference = document.createElement('div')
  reference.innerHTML = renderMarkdown(source)
  return reference.innerHTML
}

function fadeElements(root: HTMLElement): Element[] {
  return Array.from(root.querySelectorAll('.md-fade-in, .md-fade-out'))
}

function docWithIntroSuffix(suffix: string): string {
  return [
    '# Notes',
    '',
    `This is the intro paragraph with some **bold** text${suffix}.`,
    '',
    '- first item',
    '- second item',
    '',
    'A closing paragraph wraps things up.',
    '',
  ].join('\n')
}

const LARGE_DOC_PARAGRAPH_COUNT = 400

function buildLargeDoc(middleParagraphText: string): string {
  const lines: string[] = ['# Large document', '']
  for (let i = 0; i < LARGE_DOC_PARAGRAPH_COUNT; i++) {
    if (i === Math.floor(LARGE_DOC_PARAGRAPH_COUNT / 2)) {
      lines.push(middleParagraphText, '')
    } else {
      lines.push(
        `Paragraph ${i} has some **bold** text and a [link](https://example.com/${i}) in it.`,
        '',
      )
    }
  }
  return lines.join('\n')
}

describe('animatedPatch: settled-DOM-equals-full-render invariant', () => {
  let root: HTMLDivElement
  let controller: AnimatedPreviewController

  beforeEach(() => {
    vi.useFakeTimers()
    stubMatchMedia(false) // no-preference: animation path is exercised
    root = createRoot()
    controller = createAnimatedPreview(root)
  })

  afterEach(() => {
    controller.dispose()
    root.remove()
    vi.useRealTimers()
  })

  /** Applies each source in `sources` in order, settling (advancing past
   * `CLEANUP_DELAY_MS`) between every one — simulating normal-paced
   * typing where each keystroke's animation finishes before the next
   * arrives. */
  function applySettled(sources: string[]): void {
    for (const source of sources) {
      controller.apply(renderMarkdown(source))
      vi.advanceTimersByTime(CLEANUP_DELAY_MS + 10)
    }
  }

  function expectSettledInvariant(finalSource: string): void {
    expect(fadeElements(root)).toHaveLength(0)
    expect(root.innerHTML).toBe(oneShotHtml(finalSource))
  }

  it('typing forward character by character', () => {
    const target = ' and it keeps growing as the user keeps typing'
    const sources = [docWithIntroSuffix('')]
    for (let i = 1; i <= target.length; i++) {
      sources.push(docWithIntroSuffix(target.slice(0, i)))
    }

    applySettled(sources)
    expectSettledInvariant(sources[sources.length - 1])
  })

  it('deleting backward character by character', () => {
    const target = ' and it keeps growing as the user keeps typing'
    const sources: string[] = []
    for (let i = target.length; i >= 0; i--) {
      sources.push(docWithIntroSuffix(target.slice(0, i)))
    }

    applySettled(sources)
    expectSettledInvariant(sources[sources.length - 1])
  })

  it('deleting across a block boundary (backspace merges two paragraphs into one)', () => {
    const before = 'Para one.\n\nPara two.\n'
    const after = 'Para one.\nPara two.\n' // one blank-line newline removed

    // Sanity check this genuinely is a block-structure change, not just a
    // small text edit that happens to look like one — otherwise this test
    // wouldn't be exercising what its name claims.
    const beforeParagraphCount = new DOMParser()
      .parseFromString(renderMarkdown(before), 'text/html')
      .querySelectorAll('p').length
    const afterParagraphCount = new DOMParser()
      .parseFromString(renderMarkdown(after), 'text/html')
      .querySelectorAll('p').length
    expect(beforeParagraphCount).toBe(2)
    expect(afterParagraphCount).toBe(1)

    applySettled([before, after])
    expectSettledInvariant(after)
  })

  it('paste replacing everything', () => {
    const before = docWithIntroSuffix('')
    const pasted = buildLargeDoc('The pasted replacement paragraph.').slice(0, 4000)

    applySettled([before, pasted])
    expectSettledInvariant(pasted)
  })

  it('undo-style large jump back to a much shorter earlier version', () => {
    const long = buildLargeDoc('The current, much longer paragraph.').slice(0, 6000)
    const short = docWithIntroSuffix('')

    applySettled([long, short])
    expectSettledInvariant(short)
  })

  it('rapid successive edits — a newer render lands before the previous animation settles', () => {
    const target = 'abcde'
    const sources = [docWithIntroSuffix('')]
    for (let i = 1; i <= target.length; i++) {
      sources.push(docWithIntroSuffix(target.slice(0, i)))
    }

    // Deliberately no `vi.advanceTimersByTime` between calls — every
    // `apply()` after the first lands while the previous call's fade
    // spans are still pending.
    for (const source of sources) {
      controller.apply(renderMarkdown(source))
    }

    // Nothing has been settled yet — this is the actual "before settling"
    // state a rapid typist would see, not yet asserted as final.
    vi.advanceTimersByTime(CLEANUP_DELAY_MS + 10)

    expectSettledInvariant(sources[sources.length - 1])
  })

  it('two edits back-to-back with zero time between them settle to the second edit only', () => {
    // A stricter version of the rapid-edits case: apply, then immediately
    // (same tick) apply again with no intervening settle — proves the
    // first edit's pending animation is discarded, not partially applied.
    const first = docWithIntroSuffix(' first')
    const second = docWithIntroSuffix(' second, quite different')

    controller.apply(renderMarkdown(docWithIntroSuffix('')))
    vi.advanceTimersByTime(CLEANUP_DELAY_MS + 10)

    controller.apply(renderMarkdown(first))
    controller.apply(renderMarkdown(second))
    vi.advanceTimersByTime(CLEANUP_DELAY_MS + 10)

    expectSettledInvariant(second)
  })
})

describe('animatedPatch: diff threshold and fallback', () => {
  let root: HTMLDivElement
  let controller: AnimatedPreviewController

  beforeEach(() => {
    vi.useFakeTimers()
    stubMatchMedia(false)
    root = createRoot()
    controller = createAnimatedPreview(root)
  })

  afterEach(() => {
    controller.dispose()
    root.remove()
    vi.useRealTimers()
  })

  it('a single-character edit inside a text run patches locally', () => {
    controller.apply(renderMarkdown(docWithIntroSuffix('')))
    vi.advanceTimersByTime(CLEANUP_DELAY_MS + 10)

    const result = controller.apply(renderMarkdown(docWithIntroSuffix('!')))
    expect(result).toBe('patched')
  })

  it('a diff at or above HTML_DIFF_THRESHOLD falls back to a full replace', () => {
    controller.apply(renderMarkdown(docWithIntroSuffix('')))
    vi.advanceTimersByTime(CLEANUP_DELAY_MS + 10)

    // Comfortably over the threshold in inserted HTML characters alone.
    const paddedSuffix = ' ' + 'x'.repeat(HTML_DIFF_THRESHOLD)
    const result = controller.apply(renderMarkdown(docWithIntroSuffix(paddedSuffix)))
    expect(result).toBe('replaced')

    vi.advanceTimersByTime(CLEANUP_DELAY_MS + 10)
    expect(root.innerHTML).toBe(oneShotHtml(docWithIntroSuffix(paddedSuffix)))
  })

  it('an unchanged html string is a no-op', () => {
    const html = renderMarkdown(docWithIntroSuffix(''))
    controller.apply(html)
    vi.advanceTimersByTime(CLEANUP_DELAY_MS + 10)
    const before = root.innerHTML

    controller.apply(html)
    expect(root.innerHTML).toBe(before)
  })
})

describe('animatedPatch: fade-out cannot corrupt settled DOM, scroll sync, or selection', () => {
  let root: HTMLDivElement
  let controller: AnimatedPreviewController

  beforeEach(() => {
    vi.useFakeTimers()
    stubMatchMedia(false)
    root = createRoot()
    controller = createAnimatedPreview(root)
  })

  afterEach(() => {
    controller.dispose()
    root.remove()
    vi.useRealTimers()
  })

  it('mid-animation, deleted text is briefly still present, then removed once settled', () => {
    controller.apply(renderMarkdown(docWithIntroSuffix(' extra words here')))
    vi.advanceTimersByTime(CLEANUP_DELAY_MS + 10)

    const result = controller.apply(renderMarkdown(docWithIntroSuffix('')))
    expect(result).toBe('patched')

    // Before the cleanup timer fires: the fade-out span is still in the
    // DOM, holding the deleted text — genuinely longer than the source.
    const midSpans = fadeElements(root)
    expect(midSpans.some((el) => el.classList.contains('md-fade-out'))).toBe(true)
    expect(root.textContent).toContain('extra words here')
    // Not yet byte-identical to a fresh render — proving this is a real,
    // observable in-between state, not something the test would pass
    // trivially either way.
    expect(root.innerHTML).not.toBe(oneShotHtml(docWithIntroSuffix('')))

    vi.advanceTimersByTime(CLEANUP_DELAY_MS + 10)

    expect(fadeElements(root)).toHaveLength(0)
    expect(root.textContent).not.toContain('extra words here')
    expect(root.innerHTML).toBe(oneShotHtml(docWithIntroSuffix('')))
  })

  it('a fade-out span is excluded from selection/copy via user-select:none and aria-hidden', () => {
    controller.apply(renderMarkdown(docWithIntroSuffix(' extra words here')))
    vi.advanceTimersByTime(CLEANUP_DELAY_MS + 10)
    controller.apply(renderMarkdown(docWithIntroSuffix('')))

    const span = root.querySelector('.md-fade-out')
    expect(span).not.toBeNull()
    expect((span as HTMLElement).style.userSelect).toBe('none')
    expect(span?.getAttribute('aria-hidden')).toBe('true')
  })

  it('a fade-in span is normally selectable (no user-select:none)', () => {
    controller.apply(renderMarkdown(docWithIntroSuffix('')))
    vi.advanceTimersByTime(CLEANUP_DELAY_MS + 10)
    controller.apply(renderMarkdown(docWithIntroSuffix(' extra words here')))

    const span = root.querySelector('.md-fade-in')
    expect(span).not.toBeNull()
    expect((span as HTMLElement).style.userSelect).not.toBe('none')
    expect(span?.hasAttribute('aria-hidden')).toBe(false)
  })

  it('a text-only edit never disturbs the surrounding data-line element or its attributes', () => {
    const source = 'Some paragraph with a **word** in it.\n'
    controller.apply(renderMarkdown(source))
    vi.advanceTimersByTime(CLEANUP_DELAY_MS + 10)

    const originalParagraph = root.querySelector('p')
    expect(originalParagraph).not.toBeNull()
    const originalDataLine = originalParagraph?.getAttribute('data-line')

    const result = controller.apply(renderMarkdown('Some paragraph with a **wording** in it.\n'))
    expect(result).toBe('patched')

    // Same element, not a replacement — proves offsetTop-affecting
    // ancestor churn never happened for this edit.
    expect(root.querySelector('p')).toBe(originalParagraph)
    expect(originalParagraph?.getAttribute('data-line')).toBe(originalDataLine)

    vi.advanceTimersByTime(CLEANUP_DELAY_MS + 10)
    expect(root.innerHTML).toBe(oneShotHtml('Some paragraph with a **wording** in it.\n'))
  })

  it('inserting/removing a fade span is a childList mutation a MutationObserver would see', () => {
    controller.apply(renderMarkdown(docWithIntroSuffix('')))
    vi.advanceTimersByTime(CLEANUP_DELAY_MS + 10)

    const seen: MutationRecord[] = []
    const observer = new MutationObserver((records) => seen.push(...records))
    observer.observe(root, { childList: true, subtree: true, characterData: true })

    controller.apply(renderMarkdown(docWithIntroSuffix('!')))

    // jsdom delivers MutationObserver callbacks on the microtask queue —
    // fake timers don't control microtasks, so a real await is needed here.
    return Promise.resolve().then(() => {
      expect(seen.length).toBeGreaterThan(0)
      observer.disconnect()
    })
  })
})

describe('animatedPatch: mermaid-containing subtrees fall back safely', () => {
  let root: HTMLDivElement
  let controller: AnimatedPreviewController

  beforeEach(() => {
    vi.useFakeTimers()
    stubMatchMedia(false)
    root = createRoot()
    controller = createAnimatedPreview(root)
  })

  afterEach(() => {
    controller.dispose()
    root.remove()
    vi.useRealTimers()
  })

  it('an edit elsewhere in a doc with an already-rendered diagram falls back, and stays correct', () => {
    const source = [
      'Intro paragraph.',
      '',
      '```mermaid',
      'graph TD; A-->B;',
      '```',
      '',
      'Outro paragraph.',
      '',
    ].join('\n')

    controller.apply(renderMarkdown(source))
    vi.advanceTimersByTime(CLEANUP_DELAY_MS + 10)

    // Simulate what `mermaidRenderer.ts` does post-insertion: claim the
    // unrendered `pre > code.language-mermaid` and replace it with a
    // `.mermaid-diagram` wrapper. Not importing the real module here — it
    // needs a full browser/canvas — this reproduces exactly the DOM shape
    // it leaves behind, which is what this module has to cope with.
    const pre = root.querySelector('pre > code.language-mermaid')?.parentElement
    expect(pre).not.toBeNull()
    const wrapper = document.createElement('div')
    wrapper.className = 'mermaid-diagram not-prose'
    const dataLine = pre?.getAttribute('data-line')
    if (dataLine !== null && dataLine !== undefined) wrapper.setAttribute('data-line', dataLine)
    wrapper.innerHTML = '<div class="mermaid-diagram__output"><svg></svg></div>'
    pre?.replaceWith(wrapper)

    expect(root.querySelector('.mermaid-diagram')).not.toBeNull()

    // Edit the *intro* paragraph — nothing to do with the diagram.
    const editedSource = source.replace('Intro paragraph.', 'Intro paragraph edited.')
    const result = controller.apply(renderMarkdown(editedSource))

    // The live DOM's `.mermaid-diagram` wrapper never structurally matches
    // the pipeline's raw `pre/code` output at that position, so this
    // falls back — same as today's baseline (always a full replace) for
    // any edit in a document containing a rendered diagram.
    expect(result).toBe('replaced')
    vi.advanceTimersByTime(CLEANUP_DELAY_MS + 10)
    expect(root.innerHTML).toBe(oneShotHtml(editedSource))
  })
})

describe('animatedPatch: reduced motion', () => {
  let root: HTMLDivElement
  let controller: AnimatedPreviewController

  beforeEach(() => {
    vi.useFakeTimers()
    stubMatchMedia(true) // prefers-reduced-motion: reduce
    root = createRoot()
    controller = createAnimatedPreview(root)
  })

  afterEach(() => {
    controller.dispose()
    root.remove()
    vi.useRealTimers()
  })

  it('applies a small edit instantly, with no wrapper spans and nothing pending', () => {
    controller.apply(renderMarkdown(docWithIntroSuffix('')))
    // No timer advance — reduced motion must not need one.

    const result = controller.apply(renderMarkdown(docWithIntroSuffix('!')))
    expect(result).toBe('patched')
    expect(fadeElements(root)).toHaveLength(0)
    expect(root.innerHTML).toBe(oneShotHtml(docWithIntroSuffix('!')))
  })
})

describe('animatedPatch: cleanup cannot deadlock when rAF/transitionend never fire', () => {
  let root: HTMLDivElement
  let controller: AnimatedPreviewController
  let originalRaf: typeof window.requestAnimationFrame

  beforeEach(() => {
    vi.useFakeTimers()
    stubMatchMedia(false)
    root = createRoot()
    controller = createAnimatedPreview(root)
    originalRaf = window.requestAnimationFrame
    // Simulates this task's stated environment: rAF is never usable.
    // Anything in this module that depended on it to drive cleanup would
    // throw here and the test would fail loudly instead of just hanging.
    window.requestAnimationFrame = () => {
      throw new Error('requestAnimationFrame must never be called by animatedPatch.ts')
    }
  })

  afterEach(() => {
    controller.dispose()
    window.requestAnimationFrame = originalRaf
    root.remove()
    vi.useRealTimers()
  })

  it('settles via its own timer alone, with rAF poisoned throughout', () => {
    controller.apply(renderMarkdown(docWithIntroSuffix('')))
    controller.apply(renderMarkdown(docWithIntroSuffix('!')))

    expect(() => vi.advanceTimersByTime(CLEANUP_DELAY_MS + 10)).not.toThrow()
    expect(fadeElements(root)).toHaveLength(0)
    expect(root.innerHTML).toBe(oneShotHtml(docWithIntroSuffix('!')))
  })

  it('a superseding apply() settles the previous animation synchronously, without ever waiting for its timer', () => {
    controller.apply(renderMarkdown(docWithIntroSuffix('')))
    controller.apply(renderMarkdown(docWithIntroSuffix('!'))) // creates pending fade spans

    expect(fadeElements(root).length).toBeGreaterThan(0)

    // No timer advance at all — the very next call must settle the first
    // animation itself, synchronously, not depend on its own timer ever
    // firing.
    expect(() => controller.apply(renderMarkdown(docWithIntroSuffix('!!')))).not.toThrow()
    expect(root.innerHTML).toBe(oneShotHtml(docWithIntroSuffix('!!')))
  })

  it('dispose() settles synchronously with no pending timers left to fire', () => {
    controller.apply(renderMarkdown(docWithIntroSuffix('')))
    controller.apply(renderMarkdown(docWithIntroSuffix('!')))
    expect(fadeElements(root).length).toBeGreaterThan(0)

    controller.dispose()
    expect(fadeElements(root)).toHaveLength(0)

    // Any leftover timer firing later would double-invalidate the DOM;
    // proving the queue is truly empty catches that.
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('animatedPatch: typing performance on a large document', () => {
  it('patches a large document many times with no measurable per-edit blowup', () => {
    stubMatchMedia(false)
    const root = createRoot()
    const controller = createAnimatedPreview(root)

    const base = buildLargeDoc('The paragraph being edited right now.')
    controller.apply(renderMarkdown(base))

    const EDIT_COUNT = 40
    const htmls: string[] = []
    for (let i = 1; i <= EDIT_COUNT; i++) {
      htmls.push(
        renderMarkdown(buildLargeDoc(`The paragraph being edited right now${'!'.repeat(i)}.`)),
      )
    }

    const start = performance.now()
    for (const html of htmls) {
      controller.apply(html)
    }
    const elapsedMs = performance.now() - start

    controller.dispose()
    root.remove()

    const perEditMs = elapsedMs / EDIT_COUNT
    // Measured evidence requested by the task, not left-over debugging.
    console.log(
      `[animatedPatch perf] ${String(EDIT_COUNT)} edits on a ${String(LARGE_DOC_PARAGRAPH_COUNT)}-paragraph ` +
        `document: ${elapsedMs.toFixed(2)}ms total, ${perEditMs.toFixed(3)}ms/edit`,
    )

    // Generous, CI-noise-tolerant upper bound — this is a regression
    // guard against an accidental O(n²) shape, not a tight perf budget.
    expect(perEditMs).toBeLessThan(50)
  })
})

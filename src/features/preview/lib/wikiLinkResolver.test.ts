import { describe, expect, it } from 'vitest'

import { buildTitleResolver } from './wikiLinkResolver'

/**
 * Covers `buildTitleResolver` only — the pure matching logic shared by
 * `ui/Preview.vue`'s decoration pass and `src/app/wikiLinks.ts`'s click
 * handler. `decorateWikiLinks`/`resolveWikiLinksInHtml` (the DOM- and
 * `DOMParser`-touching half of this module) are exercised live in the
 * browser instead — this project's Vitest config runs in a plain Node
 * environment with no DOM (see `vitest.config.ts`), matching the existing
 * convention for this codebase's other DOM-heavy rendering modules (e.g.
 * `mermaidRenderer.ts`, also untested at the unit level for the same
 * reason).
 */
describe('buildTitleResolver', () => {
  it('resolves an exact title match', () => {
    const resolve = buildTitleResolver([{ id: 'doc-1', title: 'Project Plan' }])
    expect(resolve('Project Plan')).toEqual({ id: 'doc-1' })
  })

  it('resolves case-insensitively', () => {
    const resolve = buildTitleResolver([{ id: 'doc-1', title: 'Project Plan' }])
    expect(resolve('project plan')).toEqual({ id: 'doc-1' })
    expect(resolve('PROJECT PLAN')).toEqual({ id: 'doc-1' })
  })

  it('trims whitespace on both sides before matching', () => {
    const resolve = buildTitleResolver([{ id: 'doc-1', title: '  Project Plan  ' }])
    expect(resolve('Project Plan')).toEqual({ id: 'doc-1' })
    expect(resolve('  project plan  ')).toEqual({ id: 'doc-1' })
  })

  it('returns null for a title with no match', () => {
    const resolve = buildTitleResolver([{ id: 'doc-1', title: 'Project Plan' }])
    expect(resolve('Nonexistent')).toBeNull()
  })

  it('returns null against an empty target list', () => {
    const resolve = buildTitleResolver([])
    expect(resolve('Anything')).toBeNull()
  })

  it('the first document wins when two share a title (case-insensitively)', () => {
    const resolve = buildTitleResolver([
      { id: 'doc-1', title: 'Duplicate' },
      { id: 'doc-2', title: 'duplicate' },
    ])
    expect(resolve('Duplicate')).toEqual({ id: 'doc-1' })
  })

  it('ignores targets with a blank/whitespace-only title', () => {
    const resolve = buildTitleResolver([{ id: 'doc-1', title: '   ' }])
    expect(resolve('')).toBeNull()
    expect(resolve('   ')).toBeNull()
  })
})

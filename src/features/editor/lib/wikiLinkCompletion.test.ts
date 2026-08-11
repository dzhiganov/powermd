import { describe, expect, it } from 'vitest'

import { filterWikiLinkCandidates, type WikiLinkDocument } from './wikiLinkCompletion'

const DOCS: WikiLinkDocument[] = [
  { id: 'a', title: 'Alpha Notes' },
  { id: 'b', title: 'Bravo Plan' },
  { id: 'c', title: 'bravo backup' }, // different case, distinct title text
  { id: 'd', title: '<img src=x onerror=alert(1)>' },
]

describe('filterWikiLinkCandidates', () => {
  it('matches titles by a case-insensitive prefix', () => {
    expect(filterWikiLinkCandidates(DOCS, null, 'bra')).toEqual(['Bravo Plan', 'bravo backup'])
    expect(filterWikiLinkCandidates(DOCS, null, 'BRA')).toEqual(['Bravo Plan', 'bravo backup'])
    expect(filterWikiLinkCandidates(DOCS, null, 'Bravo P')).toEqual(['Bravo Plan'])
  })

  it('returns every other document for an empty query', () => {
    expect(filterWikiLinkCandidates(DOCS, null, '')).toEqual([
      'Alpha Notes',
      'Bravo Plan',
      'bravo backup',
      '<img src=x onerror=alert(1)>',
    ])
  })

  it('excludes the current document — a document linking to itself is noise', () => {
    expect(filterWikiLinkCandidates(DOCS, 'b', 'bra')).toEqual(['bravo backup'])
    expect(filterWikiLinkCandidates(DOCS, 'a', '')).toEqual([
      'Bravo Plan',
      'bravo backup',
      '<img src=x onerror=alert(1)>',
    ])
  })

  it('returns nothing when there are no documents at all', () => {
    expect(filterWikiLinkCandidates([], null, '')).toEqual([])
    expect(filterWikiLinkCandidates([], null, 'anything')).toEqual([])
  })

  it('returns nothing when the query matches no title', () => {
    expect(filterWikiLinkCandidates(DOCS, null, 'zzz-does-not-exist')).toEqual([])
  })

  it('de-duplicates two documents that happen to share the exact same title', () => {
    const withDuplicate: WikiLinkDocument[] = [
      { id: 'x', title: 'Same Title' },
      { id: 'y', title: 'Same Title' },
    ]
    expect(filterWikiLinkCandidates(withDuplicate, null, '')).toEqual(['Same Title'])
  })

  it('passes a title containing HTML through verbatim — this module never sanitizes or escapes', () => {
    // Safety against the string being *rendered* as markup is CodeMirror's
    // completion-list renderer's job (textContent, never innerHTML) — see
    // this module's own doc comment and the e2e coverage that inspects the
    // real DOM. This test only proves the filtering step never mangles the
    // raw string on its way through.
    const result = filterWikiLinkCandidates(DOCS, null, '<img')
    expect(result).toEqual(['<img src=x onerror=alert(1)>'])
  })
})

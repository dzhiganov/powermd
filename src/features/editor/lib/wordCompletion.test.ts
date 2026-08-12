import { describe, expect, it } from 'vitest'

import { extractWords, filterWordCompletions, type WordOccurrence } from './wordCompletion'

describe('extractWords', () => {
  it('returns nothing for an empty document', () => {
    expect(extractWords('')).toEqual([])
  })

  it('returns nothing for a document with no word characters at all', () => {
    expect(extractWords("...  --- ''  \n\n")).toEqual([])
  })

  it('returns a single entry for a document that is one word', () => {
    expect(extractWords('hello')).toEqual([{ word: 'hello', from: 0, to: 5 }])
  })

  it('splits on whitespace and ordinary punctuation, dropping the punctuation itself', () => {
    const words = extractWords('Hello, world! Markdown uses *emphasis* and `code`.')
    expect(words.map((w) => w.word)).toEqual([
      'Hello',
      'world',
      'Markdown',
      'uses',
      'emphasis',
      'and',
      'code',
    ])
  })

  it('keeps interior hyphens and apostrophes as part of the word', () => {
    const words = extractWords("state-of-the-art results, don't skip them")
    expect(words.map((w) => w.word)).toEqual([
      'state-of-the-art',
      'results',
      "don't",
      'skip',
      'them',
    ])
  })

  it('drops a trailing hyphen (line-wrap style) that is not followed by another letter/digit', () => {
    const words = extractWords('co-op-')
    expect(words).toEqual([{ word: 'co-op', from: 0, to: 5 }])
  })

  it('drops a leading/trailing apostrophe from a quoted word', () => {
    const words = extractWords("'quote'")
    expect(words.map((w) => w.word)).toEqual(['quote'])
  })

  it('treats a bare hyphen (a markdown list bullet) as no word at all', () => {
    expect(extractWords('- item one').map((w) => w.word)).toEqual(['item', 'one'])
  })

  it('records accurate offsets for each occurrence', () => {
    const words = extractWords('cat dog cat')
    expect(words).toEqual([
      { word: 'cat', from: 0, to: 3 },
      { word: 'dog', from: 4, to: 7 },
      { word: 'cat', from: 8, to: 11 },
    ])
  })

  it('treats letters and digits from any script as word characters', () => {
    expect(extractWords('café résumé 日本語 abc123').map((w) => w.word)).toEqual([
      'café',
      'résumé',
      '日本語',
      'abc123',
    ])
  })
})

describe('filterWordCompletions', () => {
  it('matches by a case-insensitive prefix', () => {
    const occurrences: WordOccurrence[] = [{ word: 'JavaScript', from: 0, to: 10 }]
    expect(
      filterWordCompletions(occurrences, { query: 'java', cursorPos: 100, excludeFrom: -1 }),
    ).toEqual(['JavaScript'])
    expect(
      filterWordCompletions(occurrences, { query: 'JAVA', cursorPos: 100, excludeFrom: -1 }),
    ).toEqual(['JavaScript'])
    expect(
      filterWordCompletions(occurrences, { query: 'py', cursorPos: 100, excludeFrom: -1 }),
    ).toEqual([])
  })

  it('keeps differently-cased spellings as distinct candidates', () => {
    const occurrences: WordOccurrence[] = [
      { word: 'Cat', from: 0, to: 3 },
      { word: 'cat', from: 10, to: 13 },
    ]
    const result = filterWordCompletions(occurrences, {
      query: 'ca',
      cursorPos: 100,
      excludeFrom: -1,
    })
    expect(result).toContain('Cat')
    expect(result).toContain('cat')
    expect(result).toHaveLength(2)
  })

  it('excludes the in-progress occurrence by position, not by text', () => {
    // A finished "widget" earlier in the document, plus the word currently
    // being typed — only "wid" exists in the document text so far, at the
    // position identified by `excludeFrom`.
    const occurrences: WordOccurrence[] = [
      { word: 'widget', from: 0, to: 6 },
      { word: 'wid', from: 20, to: 23 }, // in progress, from == excludeFrom
    ]
    const result = filterWordCompletions(occurrences, {
      query: 'wid',
      cursorPos: 23,
      excludeFrom: 20,
    })
    // The in-progress occurrence at `from: 20` is excluded, but the
    // completed "widget" elsewhere in the document is still offered.
    expect(result).toEqual(['widget'])
  })

  it('excludes a candidate that is already identical to what has been typed', () => {
    // "cat" appears twice already, and the user has just finished typing a
    // third "cat" (excludeFrom is that third occurrence). The two earlier
    // ones are real, separate occurrences, but their text is identical to
    // the query — completing them would insert zero new characters.
    const occurrences: WordOccurrence[] = [
      { word: 'cat', from: 0, to: 3 },
      { word: 'cat', from: 10, to: 13 },
      { word: 'cat', from: 20, to: 23 },
    ]
    const result = filterWordCompletions(occurrences, {
      query: 'cat',
      cursorPos: 23,
      excludeFrom: 20,
    })
    expect(result).toEqual([])
  })

  it('collapses duplicate occurrences of the same word into one candidate', () => {
    const occurrences: WordOccurrence[] = [
      { word: 'widget', from: 0, to: 6 },
      { word: 'widget', from: 50, to: 56 },
      { word: 'widget', from: 100, to: 106 },
    ]
    const result = filterWordCompletions(occurrences, {
      query: 'wid',
      cursorPos: 200,
      excludeFrom: -1,
    })
    expect(result).toEqual(['widget'])
  })

  it('returns nothing for an empty occurrence list', () => {
    expect(filterWordCompletions([], { query: 'any', cursorPos: 0, excludeFrom: -1 })).toEqual([])
  })

  it('returns nothing when no occurrence matches the query', () => {
    const occurrences: WordOccurrence[] = [{ word: 'widget', from: 0, to: 6 }]
    expect(
      filterWordCompletions(occurrences, { query: 'zzz', cursorPos: 0, excludeFrom: -1 }),
    ).toEqual([])
  })

  it('orders by frequency first: a word used more often ranks above one used less, regardless of distance', () => {
    const occurrences: WordOccurrence[] = [
      // "widen" used once, very close to the cursor.
      { word: 'widen', from: 95, to: 100 },
      // "widget" used three times, all far from the cursor.
      { word: 'widget', from: 0, to: 6 },
      { word: 'widget', from: 500, to: 506 },
      { word: 'widget', from: 1000, to: 1006 },
    ]
    const result = filterWordCompletions(occurrences, {
      query: 'wid',
      cursorPos: 100,
      excludeFrom: -1,
    })
    expect(result).toEqual(['widget', 'widen'])
  })

  it('orders by proximity to the cursor as a tie-break within equal frequency', () => {
    const occurrences: WordOccurrence[] = [
      { word: 'widen', from: 0, to: 5 }, // far from cursor
      { word: 'widget', from: 95, to: 101 }, // close to cursor
    ]
    const result = filterWordCompletions(occurrences, {
      query: 'wid',
      cursorPos: 100,
      excludeFrom: -1,
    })
    expect(result).toEqual(['widget', 'widen'])
  })

  it('orders alphabetically as the final tie-break when frequency and distance are equal', () => {
    const occurrences: WordOccurrence[] = [
      { word: 'widget', from: 0, to: 6 },
      { word: 'widen', from: 200, to: 205 },
    ]
    // Both occur once, and both sit exactly 100 away from the cursor.
    const result = filterWordCompletions(occurrences, {
      query: 'wid',
      cursorPos: 100,
      excludeFrom: -1,
    })
    expect(result).toEqual(['widen', 'widget'])
  })
})

import { describe, expect, it } from 'vitest'

import { findActiveParagraph } from './focusMode'

describe('findActiveParagraph', () => {
  it('finds a middle paragraph, bounded by the blank lines around it', () => {
    const source = 'one\n\ntwo\nstill two\n\nthree\n'
    expect(findActiveParagraph(source, 3)).toEqual({ fromLine: 3, toLine: 4 })
    expect(findActiveParagraph(source, 4)).toEqual({ fromLine: 3, toLine: 4 })
  })

  it('finds the first paragraph when the cursor is on line 1', () => {
    const source = 'one\ntwo\n\nthree\n'
    expect(findActiveParagraph(source, 1)).toEqual({ fromLine: 1, toLine: 2 })
  })

  it('finds the last paragraph when the cursor is on the final line', () => {
    const source = 'one\n\ntwo\nthree'
    expect(findActiveParagraph(source, 4)).toEqual({ fromLine: 3, toLine: 4 })
  })

  it('returns null for an empty document', () => {
    expect(findActiveParagraph('', 1)).toBeNull()
  })

  it('treats a document with no blank lines at all as one paragraph', () => {
    const source = 'one\ntwo\nthree'
    expect(findActiveParagraph(source, 1)).toEqual({ fromLine: 1, toLine: 3 })
    expect(findActiveParagraph(source, 2)).toEqual({ fromLine: 1, toLine: 3 })
    expect(findActiveParagraph(source, 3)).toEqual({ fromLine: 1, toLine: 3 })
  })

  it('returns null when the cursor sits on a blank line between paragraphs — nothing is active', () => {
    const source = 'one\n\ntwo\n'
    expect(findActiveParagraph(source, 2)).toBeNull()
  })

  it('lights up the whole fenced code block, delimiters included, even around a blank line inside it', () => {
    const source = 'prose\n\n```\nline1\n\nline2\n```\n\nmore prose\n'
    // fence opener (```) is line 3, closer is line 7
    expect(findActiveParagraph(source, 3)).toEqual({ fromLine: 3, toLine: 7 })
    expect(findActiveParagraph(source, 4)).toEqual({ fromLine: 3, toLine: 7 })
    // the blank line INSIDE the fence (line 5) is still part of the block,
    // unlike a blank line between top-level paragraphs.
    expect(findActiveParagraph(source, 5)).toEqual({ fromLine: 3, toLine: 7 })
    expect(findActiveParagraph(source, 7)).toEqual({ fromLine: 3, toLine: 7 })
  })

  it('swallows an unclosed fence to the end of the document', () => {
    const source = 'prose\n\n```\ncode\nmore code'
    expect(findActiveParagraph(source, 4)).toEqual({ fromLine: 3, toLine: 5 })
  })

  it('does not let a fence boundary merge into adjacent prose with no blank line', () => {
    const source = 'prose\n```\ncode\n```\nmore prose\n'
    expect(findActiveParagraph(source, 1)).toEqual({ fromLine: 1, toLine: 1 })
    expect(findActiveParagraph(source, 5)).toEqual({ fromLine: 5, toLine: 5 })
  })

  it('lights up an entire list (no blank lines between items) as one block', () => {
    const source = '- one\n- two\n- three\n'
    expect(findActiveParagraph(source, 2)).toEqual({ fromLine: 1, toLine: 3 })
  })

  it('splits a loose list (blank lines between items) at those blank lines', () => {
    const source = '- one\n\n- two\n\n- three\n'
    expect(findActiveParagraph(source, 3)).toEqual({ fromLine: 3, toLine: 3 })
  })

  it('returns null for an out-of-range cursor line', () => {
    const source = 'one\ntwo\n'
    expect(findActiveParagraph(source, 0)).toBeNull()
    expect(findActiveParagraph(source, 99)).toBeNull()
  })
})

import { describe, it, expect } from 'vitest'

import { resolveFenceCompletion } from './codeFence'

function resolve(before: string, after = '', insideFencedCode = false) {
  return resolveFenceCompletion({ before, after, insideFencedCode })
}

describe('resolveFenceCompletion', () => {
  it('completes the fence when the two backticks are alone on the line', () => {
    // The typed backtick, then a newline, then the closing fence — so the
    // document reads "```\n```" with the cursor at the end of the first.
    expect(resolve('``')).toEqual({ insert: '`\n```', cursorOffset: 1 })
  })

  it('leaves the cursor at the end of the opening fence, ready for a language', () => {
    const completion = resolve('``')!
    // Offset 1 == just past the backtick that was typed, i.e. after "```".
    expect(completion.insert.slice(0, completion.cursorOffset)).toBe('`')
  })

  it('indents the closing fence to match the opening one', () => {
    // A block inside a list item is indented; a closing fence flush left
    // would not close it where the writer meant.
    expect(resolve('    ``')).toEqual({ insert: '`\n    ```', cursorOffset: 1 })
    expect(resolve('\t``')).toEqual({ insert: '`\n\t```', cursorOffset: 1 })
  })

  it('does nothing inside an existing fenced block', () => {
    // This third backtick is the user closing the block by hand. Completing
    // it would add a second closing fence and strand the first.
    expect(resolve('``', '', true)).toBeNull()
  })

  it('does nothing when the backticks are not alone on the line', () => {
    // Not a fence at all under CommonMark — a fence has to open its own line.
    expect(resolve('see ``')).toBeNull()
    expect(resolve('x``')).toBeNull()
  })

  it('does nothing when only one backtick precedes the cursor', () => {
    // The first two backticks of inline code must stay inert.
    expect(resolve('`')).toBeNull()
    expect(resolve('')).toBeNull()
  })

  it('does nothing when more than two backticks precede the cursor', () => {
    // Already a fence; a fourth backtick just widens it.
    expect(resolve('```')).toBeNull()
    expect(resolve('````')).toBeNull()
  })

  it('does nothing when text follows the cursor on the line', () => {
    // Editing inside existing text — inserting a newline here would cut that
    // text off from what precedes it.
    expect(resolve('``', 'rest of the line')).toBeNull()
    expect(resolve('``', '``')).toBeNull()
  })

  it('still fires when only whitespace follows the cursor', () => {
    // Trailing spaces are invisible and shouldn't silently disable this.
    expect(resolve('``', '   ')).toEqual({ insert: '`\n```', cursorOffset: 1 })
  })

  it('does not treat a non-backtick prefix character as part of the fence', () => {
    expect(resolve('-``')).toBeNull()
    expect(resolve('> ``')).toBeNull()
  })
})

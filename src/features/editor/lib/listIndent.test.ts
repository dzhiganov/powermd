import { describe, expect, it } from 'vitest'

import { indentListLines, outdentListLines } from './listIndent'

describe('indentListLines', () => {
  it('indents a second item under a first', () => {
    const source = '- one\n- two\n'
    expect(indentListLines(source, 2, 2)).toBe('- one\n  - two\n')
  })

  it('refuses on the first item of a list — nothing above it to nest under', () => {
    const source = '- one\n- two\n'
    expect(indentListLines(source, 1, 1)).toBeNull()
  })

  it('refuses on an item that is already the first (only) child at its own depth', () => {
    // "two" has no sibling AT indent 2 above it — "one" is shallower, so
    // scanning upward hits it before finding a same-level sibling.
    const source = '- one\n  - two\n'
    expect(indentListLines(source, 2, 2)).toBeNull()
  })

  it('indents an already-nested item one level deeper, under its own sibling', () => {
    const source = '- one\n  - two\n  - three\n'
    expect(indentListLines(source, 3, 3)).toBe('- one\n  - two\n    - three\n')
  })

  it('skips blank lines when searching for a sibling to nest under', () => {
    const source = '- one\n\n- two\n'
    expect(indentListLines(source, 3, 3)).toBe('- one\n\n  - two\n')
  })

  it('indents an ordered-list item, rewriting its own number to "1."', () => {
    const source = '1. one\n2. two\n'
    expect(indentListLines(source, 2, 2)).toBe('1. one\n   1. two\n')
  })

  it('does not touch an ordered item whose number is already "1."', () => {
    const source = '1. one\n1. two\n'
    expect(indentListLines(source, 2, 2)).toBe('1. one\n   1. two\n')
  })

  it('preserves the ")" delimiter style when rewriting an ordered number', () => {
    const source = '1) one\n2) two\n'
    expect(indentListLines(source, 2, 2)).toBe('1) one\n   1) two\n')
  })

  it('indents a task-list item, keeping its marker and checkbox intact', () => {
    const source = '- [ ] one\n- [ ] two\n'
    expect(indentListLines(source, 2, 2)).toBe('- [ ] one\n  - [ ] two\n')
  })

  it('indents a checked task-list item without altering the checked state', () => {
    const source = '- [ ] one\n- [x] two\n'
    expect(indentListLines(source, 2, 2)).toBe('- [ ] one\n  - [x] two\n')
  })

  it('is a no-op (refuses) for a line that is not a list item at all', () => {
    const source = 'Just a paragraph, nothing to indent.\n'
    expect(indentListLines(source, 1, 1)).toBeNull()
  })

  it('refuses to indent a line inside a fenced code block, even if it looks like a list item', () => {
    const source = '```\n- not a real list item\n```\n'
    expect(indentListLines(source, 2, 2)).toBeNull()
  })

  it('refuses when the fence is never closed', () => {
    const source = '```\n- inside an unterminated fence\n'
    expect(indentListLines(source, 2, 2)).toBeNull()
  })

  it('carries a nested child along by the same delta as its moved parent', () => {
    const source = '- one\n- two\n  - child\n'
    expect(indentListLines(source, 2, 2)).toBe('- one\n  - two\n    - child\n')
  })

  it('indents every list item touched by a multi-line selection, nesting them as siblings', () => {
    const source = '- one\n- two\n- three\n'
    expect(indentListLines(source, 2, 3)).toBe('- one\n  - two\n  - three\n')
  })

  it('refuses the whole multi-line indent if any touched item has no valid target', () => {
    // Line 1 has nothing above it — the selection covering it must refuse
    // entirely rather than partially indent line 2.
    const source = '- one\n- two\n'
    expect(indentListLines(source, 1, 2)).toBeNull()
  })

  it('is a no-op (refuses) for a line number below the document range', () => {
    const source = '- one\n'
    expect(indentListLines(source, 0, 0)).toBeNull()
  })

  it('is a no-op (refuses) for a line number past the end of the document', () => {
    const source = '- one\n'
    expect(indentListLines(source, 5, 5)).toBeNull()
  })

  it('preserves a "*" or "+" bullet character rather than normalising it', () => {
    expect(indentListLines('* one\n* two\n', 2, 2)).toBe('* one\n  * two\n')
    expect(indentListLines('+ one\n+ two\n', 2, 2)).toBe('+ one\n  + two\n')
  })
})

describe('outdentListLines', () => {
  it('outdents a nested item back to the top level', () => {
    const source = '- one\n  - two\n'
    expect(outdentListLines(source, 2, 2)).toBe('- one\n- two\n')
  })

  it('round-trips: indent then outdent restores the original text', () => {
    const original = '- one\n- two\n'
    const indented = indentListLines(original, 2, 2)
    expect(indented).not.toBeNull()
    expect(outdentListLines(indented as string, 2, 2)).toBe(original)
  })

  it('refuses to outdent an item already at the top level', () => {
    const source = '- one\n- two\n'
    expect(outdentListLines(source, 1, 1)).toBeNull()
    expect(outdentListLines(source, 2, 2)).toBeNull()
  })

  it('outdents by one level at a time from a doubly-nested item', () => {
    const source = '- one\n  - two\n    - three\n'
    expect(outdentListLines(source, 3, 3)).toBe('- one\n  - two\n  - three\n')
  })

  it('carries a nested child along when its parent outdents', () => {
    const source = '- one\n  - two\n    - child\n'
    expect(outdentListLines(source, 2, 2)).toBe('- one\n- two\n  - child\n')
  })

  it('does not rewrite an ordered item’s number when outdenting', () => {
    const source = '1. one\n   1. two\n'
    expect(outdentListLines(source, 2, 2)).toBe('1. one\n1. two\n')
  })

  it('outdents a task-list item, keeping its checkbox intact', () => {
    const source = '- [ ] one\n  - [x] two\n'
    expect(outdentListLines(source, 2, 2)).toBe('- [ ] one\n- [x] two\n')
  })

  it('is a no-op (refuses) for a line that is not a list item at all', () => {
    expect(outdentListLines('Just a paragraph.\n', 1, 1)).toBeNull()
  })

  it('refuses to outdent a line inside a fenced code block', () => {
    const source = '```\n  - inside a fence\n```\n'
    expect(outdentListLines(source, 2, 2)).toBeNull()
  })

  it('outdents every list item touched by a multi-line selection together', () => {
    const source = '- one\n  - two\n  - three\n'
    expect(outdentListLines(source, 2, 3)).toBe('- one\n- two\n- three\n')
  })
})

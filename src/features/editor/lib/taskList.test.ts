import { describe, expect, it } from 'vitest'

import { toggleTaskListItem } from './taskList'

describe('toggleTaskListItem', () => {
  it('toggles an unchecked item to checked', () => {
    const source = '- [ ] one\n- [ ] two\n'
    expect(toggleTaskListItem(source, 1)).toBe('- [x] one\n- [ ] two\n')
  })

  it('toggles a checked item back to unchecked', () => {
    const source = '- [x] one\n- [ ] two\n'
    expect(toggleTaskListItem(source, 1)).toBe('- [ ] one\n- [ ] two\n')
  })

  it('normalizes an uppercase [X] to [ ] on uncheck', () => {
    const source = '- [X] done\n'
    expect(toggleTaskListItem(source, 1)).toBe('- [ ] done\n')
  })

  it('toggles only the marker, leaving a literal "[ ]" later on the same line untouched', () => {
    const source = '- [ ] task with [ ] literal brackets\n'
    expect(toggleTaskListItem(source, 1)).toBe('- [x] task with [ ] literal brackets\n')
  })

  it('toggles only the marker, leaving a literal "[x]" later on the same line untouched', () => {
    const source = '- [x] task with [x] literal brackets\n'
    expect(toggleTaskListItem(source, 1)).toBe('- [ ] task with [x] literal brackets\n')
  })

  it('handles nested items at a 2-space indent', () => {
    const source = '- [ ] outer\n  - [x] inner\n'
    expect(toggleTaskListItem(source, 2)).toBe('- [ ] outer\n  - [ ] inner\n')
  })

  it('handles nested items at a 4-space indent', () => {
    const source = '- [ ] outer\n    - [ ] inner\n'
    expect(toggleTaskListItem(source, 2)).toBe('- [ ] outer\n    - [x] inner\n')
  })

  it('handles a tab-indented nested item', () => {
    const source = '- [ ] outer\n\t- [ ] inner\n'
    expect(toggleTaskListItem(source, 2)).toBe('- [ ] outer\n\t- [x] inner\n')
  })

  it('handles an item inside a blockquote', () => {
    const source = '> - [ ] quoted\n'
    expect(toggleTaskListItem(source, 1)).toBe('> - [x] quoted\n')
  })

  it('handles a nested item inside a blockquote', () => {
    const source = '> - [ ] a\n>   - [x] b\n'
    expect(toggleTaskListItem(source, 2)).toBe('> - [ ] a\n>   - [ ] b\n')
  })

  it('is a no-op for a line that is not a task item at all', () => {
    const source = '# Heading\n\nJust a paragraph with [ ] in it, not a list.\n'
    expect(toggleTaskListItem(source, 3)).toBe(source)
  })

  it('is a no-op for a plain (non-task) list item', () => {
    const source = '- a plain bullet\n'
    expect(toggleTaskListItem(source, 1)).toBe(source)
  })

  it('is a no-op for a bare "- []" (not valid GFM task syntax)', () => {
    const source = '- [] not a task\n'
    expect(toggleTaskListItem(source, 1)).toBe(source)
  })

  it('is a no-op for a line number below the document range', () => {
    const source = '- [ ] one\n'
    expect(toggleTaskListItem(source, 0)).toBe(source)
  })

  it('is a no-op for a line number past the end of the document', () => {
    const source = '- [ ] one\n'
    expect(toggleTaskListItem(source, 5)).toBe(source)
  })

  it('changes only the requested line when several task items are identical', () => {
    const source = '- [ ] dup\n- [ ] dup\n- [ ] dup\n'
    expect(toggleTaskListItem(source, 2)).toBe('- [ ] dup\n- [x] dup\n- [ ] dup\n')
  })

  it('toggles an ordered-list task item', () => {
    const source = '1. [ ] one\n2. [x] two\n'
    expect(toggleTaskListItem(source, 2)).toBe('1. [ ] one\n2. [ ] two\n')
  })
})

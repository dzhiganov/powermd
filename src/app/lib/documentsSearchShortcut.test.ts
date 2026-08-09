import { describe, expect, it } from 'vitest'

import { isDocumentsSearchShortcut, type ModifierKeyEvent } from './documentsSearchShortcut'

const BASE: ModifierKeyEvent = {
  key: 'f',
  altKey: false,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
}

describe('isDocumentsSearchShortcut', () => {
  it('matches Ctrl+Shift+F', () => {
    expect(isDocumentsSearchShortcut({ ...BASE, ctrlKey: true, shiftKey: true })).toBe(true)
  })

  it('matches Cmd+Shift+F (metaKey, macOS)', () => {
    expect(isDocumentsSearchShortcut({ ...BASE, metaKey: true, shiftKey: true })).toBe(true)
  })

  it('is case-insensitive on the key itself', () => {
    expect(isDocumentsSearchShortcut({ ...BASE, key: 'F', ctrlKey: true, shiftKey: true })).toBe(
      true,
    )
  })

  it('rejects a bare Ctrl+F (no Shift) — that is in-file find, not this shortcut', () => {
    expect(isDocumentsSearchShortcut({ ...BASE, ctrlKey: true })).toBe(false)
  })

  it('rejects Shift+F with no Ctrl/Cmd at all', () => {
    expect(isDocumentsSearchShortcut({ ...BASE, shiftKey: true })).toBe(false)
  })

  it('rejects when Alt is also held', () => {
    expect(
      isDocumentsSearchShortcut({ ...BASE, ctrlKey: true, shiftKey: true, altKey: true }),
    ).toBe(false)
  })

  it('rejects a different key entirely', () => {
    expect(isDocumentsSearchShortcut({ ...BASE, key: 'g', ctrlKey: true, shiftKey: true })).toBe(
      false,
    )
  })

  it('accepts Ctrl+Cmd+Shift+F too (both modifiers held is still a valid trigger)', () => {
    expect(
      isDocumentsSearchShortcut({ ...BASE, ctrlKey: true, metaKey: true, shiftKey: true }),
    ).toBe(true)
  })
})

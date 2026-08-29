import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  initHighlights,
  activeDocumentChanged,
  selectionChanged,
  documentTextChanged,
  rangesRemapped,
  highlightCreated,
  highlightNoteSet,
  highlightRemoved,
  $highlights,
  type Highlight,
} from './highlights'

const save = vi.fn<(highlights: readonly Highlight[]) => Promise<void>>()
const remove = vi.fn<(ids: readonly string[]) => Promise<void>>()
const load = vi.fn<(documentId: string) => Promise<Highlight[]>>()

beforeEach(() => {
  save.mockReset().mockResolvedValue(undefined)
  remove.mockReset().mockResolvedValue(undefined)
  load.mockReset().mockResolvedValue([])
  initHighlights({ load, save, remove })
  activeDocumentChanged('doc-1')
  documentTextChanged('The quick brown fox jumps over the lazy dog.')
})

/** Selects "brown" (offsets 10..15). */
function selectBrown(): void {
  selectionChanged({ from: 10, to: 15, text: 'brown', rect: null })
}

describe('creating', () => {
  it('creates a highlight over the current selection', () => {
    selectBrown()
    highlightCreated({ color: 'amber', note: '' })

    expect($highlights.getState()).toHaveLength(1)
    expect($highlights.getState()[0]).toMatchObject({
      documentId: 'doc-1',
      from: 10,
      to: 15,
      text: 'brown',
      color: 'amber',
      note: '',
    })
  })

  it('persists the new highlight', () => {
    selectBrown()
    highlightCreated({ color: 'amber', note: '' })
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0]).toHaveLength(1)
  })

  it('creates with a note in one step', () => {
    selectBrown()
    highlightCreated({ color: 'green', note: 'Check this' })
    expect($highlights.getState()[0]).toMatchObject({ note: 'Check this', color: 'green' })
  })

  it('does nothing without a selection', () => {
    selectionChanged(null)
    highlightCreated({ color: 'amber', note: '' })
    expect($highlights.getState()).toHaveLength(0)
  })

  it('does nothing for a whitespace-only selection', () => {
    selectionChanged({ from: 3, to: 4, text: ' ', rect: null })
    highlightCreated({ color: 'amber', note: '' })
    expect($highlights.getState()).toHaveLength(0)
  })

  it('keeps the list in reading order, not creation order', () => {
    selectionChanged({ from: 35, to: 38, text: 'dog', rect: null })
    highlightCreated({ color: 'amber', note: '' })
    selectBrown()
    highlightCreated({ color: 'blue', note: '' })

    expect($highlights.getState().map((h) => h.text)).toEqual(['brown', 'dog'])
  })
})

describe('editing', () => {
  it('updates a note and persists it', () => {
    selectBrown()
    highlightCreated({ color: 'amber', note: '' })
    const id = $highlights.getState()[0].id
    save.mockClear()

    highlightNoteSet({ id, note: 'Later thought' })

    expect($highlights.getState()[0].note).toBe('Later thought')
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('removes a highlight and deletes it from storage', () => {
    selectBrown()
    highlightCreated({ color: 'amber', note: '' })
    const id = $highlights.getState()[0].id

    highlightRemoved(id)

    expect($highlights.getState()).toHaveLength(0)
    expect(remove).toHaveBeenCalledWith([id])
  })
})

describe('re-anchoring', () => {
  it('applies moved offsets and refreshes the cached text', () => {
    selectBrown()
    highlightCreated({ color: 'amber', note: '' })
    const id = $highlights.getState()[0].id

    // Text inserted before it: offsets shift by 4, and the cached quote must
    // be re-read from the NEW text at the NEW offsets.
    documentTextChanged('Once The quick brown fox jumps over the lazy dog.')
    rangesRemapped({ moved: [{ id, from: 15, to: 20 }], removed: [] })

    expect($highlights.getState()[0]).toMatchObject({ from: 15, to: 20, text: 'brown' })
  })

  it('drops highlights whose text was deleted', () => {
    selectBrown()
    highlightCreated({ color: 'amber', note: '' })
    const id = $highlights.getState()[0].id
    remove.mockClear()

    rangesRemapped({ moved: [], removed: [id] })

    expect($highlights.getState()).toHaveLength(0)
    expect(remove).toHaveBeenCalledWith([id])
  })

  it('writes nothing when an edit moved no ranges', () => {
    selectBrown()
    highlightCreated({ color: 'amber', note: '' })
    save.mockClear()
    remove.mockClear()

    rangesRemapped({ moved: [], removed: [] })

    expect(save).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })
})

describe('switching documents', () => {
  it('replaces the list with the newly opened document’s highlights', async () => {
    selectBrown()
    highlightCreated({ color: 'amber', note: '' })
    expect($highlights.getState()).toHaveLength(1)

    load.mockResolvedValue([
      {
        id: 'other',
        documentId: 'doc-2',
        from: 0,
        to: 3,
        color: 'blue',
        note: '',
        text: 'abc',
        createdAt: 1,
      },
    ])
    activeDocumentChanged('doc-2')
    await vi.waitFor(() => expect($highlights.getState()).toHaveLength(1))

    expect($highlights.getState()[0].id).toBe('other')
  })
})

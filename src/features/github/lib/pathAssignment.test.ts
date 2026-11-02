import { describe, expect, it } from 'vitest'

import { assignPaths, planPathMoves, type MoveDoc } from './pathAssignment'

const CONNECTION = { owner: 'alice', repo: 'notes', branch: 'main', subfolder: '' }

function doc(
  id: string,
  title: string,
  path: string,
  syncedHash: string | null = 'hash',
  folderId: string | null = null,
): MoveDoc {
  return { id, title, folderId, origin: { ...CONNECTION, path, syncedHash } }
}

describe('assignPaths', () => {
  it('names a new document after its title, deduplicated', () => {
    const { docPaths } = assignPaths(
      CONNECTION,
      [],
      [doc('a', 'Notes', 'notes.md'), { id: 'b', title: 'Notes', folderId: null, origin: null }],
    )
    expect(docPaths).toEqual([{ id: 'b', path: 'notes-2.md' }])
  })
})

describe('planPathMoves', () => {
  it('moves a document renamed away from "Untitled", removing the old file', () => {
    expect(planPathMoves(CONNECTION, [], [doc('a', 'Architecture', 'untitled-3.md')])).toEqual([
      { id: 'a', path: 'architecture.md', removeOld: true },
    ])
  })

  it('does not remove anything for a document that was never pushed', () => {
    expect(planPathMoves(CONNECTION, [], [doc('a', 'Ideas', 'untitled.md', null)])).toEqual([
      { id: 'a', path: 'ideas.md', removeOld: false },
    ])
  })

  it('leaves paths that still fit the title alone', () => {
    expect(
      planPathMoves(
        CONNECTION,
        [],
        [
          doc('a', 'Untitled', 'untitled-3.md'),
          doc('b', 'Notes', 'notes.md'),
          doc('c', 'My Notes', 'My Notes.md'), // imported, keeps its own name
          doc('d', 'Draft', 'draft.markdown'),
        ],
      ),
    ).toEqual([])
  })

  it('moves a document into its new folder’s directory', () => {
    const folders = [{ id: 'f', name: 'Work', syncDirPath: 'work' }]
    expect(planPathMoves(CONNECTION, folders, [doc('a', 'Plan', 'plan.md', 'h', 'f')])).toEqual([
      { id: 'a', path: 'work/plan.md', removeOld: true },
    ])
  })

  it('waits for a folder to get its directory before moving into it', () => {
    const folders = [{ id: 'f', name: 'Work', syncDirPath: null }]
    expect(planPathMoves(CONNECTION, folders, [doc('a', 'Plan', 'plan.md', 'h', 'f')])).toEqual([])
  })

  it('never takes a path another document holds', () => {
    expect(
      planPathMoves(
        CONNECTION,
        [],
        [doc('a', 'Notes', 'untitled.md'), doc('b', 'Notes', 'notes.md')],
      ),
    ).toEqual([{ id: 'a', path: 'notes-2.md', removeOld: true }])
  })

  it('moves the never-pushed one of two documents claiming one file, leaving the file alone', () => {
    // A local "Notes" was assigned notes.md; the first-connect import then
    // found an existing notes.md on GitHub.
    expect(
      planPathMoves(
        CONNECTION,
        [],
        [doc('a-local', 'Notes', 'notes.md', null), doc('b-imported', 'notes', 'notes.md', 'h')],
      ),
    ).toEqual([{ id: 'a-local', path: 'notes-2.md', removeOld: false }])
  })

  it('leaves documents synced under another subfolder where they are', () => {
    expect(
      planPathMoves({ ...CONNECTION, subfolder: 'journal' }, [], [doc('a', 'Renamed', 'old/x.md')]),
    ).toEqual([])
  })

  it('is stable: once moved, a document stays put', () => {
    const [move] = planPathMoves(CONNECTION, [], [doc('a', 'Architecture', 'untitled-3.md')])
    expect(planPathMoves(CONNECTION, [], [doc('a', 'Architecture', move.path)])).toEqual([])
  })
})

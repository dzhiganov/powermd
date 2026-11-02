import { describe, expect, it } from 'vitest'

import { assignPaths, planPathMoves, type MoveDoc } from './pathAssignment'

const CONNECTION = { owner: 'alice', repo: 'notes', branch: 'main', subfolder: '' }

/** A synced document whose path was named after `placedTitle` (by default
 * the title it still has) at the root. */
function doc(
  id: string,
  title: string,
  path: string,
  syncedHash: string | null = 'hash',
  folderId: string | null = null,
  placedTitle = 'Untitled',
): MoveDoc {
  return {
    id,
    title,
    folderId,
    origin: { ...CONNECTION, path, syncedHash, placedAs: { title: placedTitle, folderId: null } },
  }
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

  it('never moves a path synced by an older version, however it is named', () => {
    const legacy = (id: string, title: string, path: string): MoveDoc => ({
      id,
      title,
      folderId: null,
      origin: { ...CONNECTION, path, syncedHash: 'hash' },
    })
    expect(
      planPathMoves(
        CONNECTION,
        [],
        [legacy('a', 'Architecture', 'untitled-3.md'), legacy('b', 'Ideas', 'drafts/custom.md')],
      ),
    ).toEqual([])
  })

  it('does not move a document whose folder this tab does not know', () => {
    expect(
      // Renamed, and filed in a folder another tab just created.
      planPathMoves(CONNECTION, [], [doc('a', 'Roadmap', 'plan.md', 'h', 'folder-from-other-tab')]),
    ).toEqual([])
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
    expect(
      planPathMoves(
        CONNECTION,
        [],
        [doc('a', 'Architecture', move.path, 'h', null, 'Architecture')],
      ),
    ).toEqual([])
  })

  describe('against the files on the branch', () => {
    const remote = (...paths: string[]) => ({ paths: new Set(paths), truncated: false })

    it('never renames onto a file no local document owns', () => {
      // "Todo" was deleted locally; its todo.md stays on GitHub.
      expect(
        planPathMoves(
          CONNECTION,
          [],
          [doc('a', 'Todo', 'untitled.md')],
          remote('untitled.md', 'todo.md'),
        ),
      ).toEqual([{ id: 'a', path: 'todo-2.md', removeOld: true }])
    })

    it('moves a never-pushed document off a file that is already there', () => {
      expect(
        planPathMoves(
          CONNECTION,
          [],
          [doc('a', 'Todo', 'todo.md', null, null, 'Todo')],
          remote('todo.md'),
        ),
      ).toEqual([{ id: 'a', path: 'todo-2.md', removeOld: false }])
    })

    it('leaves a pushed document on its own file', () => {
      expect(
        planPathMoves(
          CONNECTION,
          [],
          [doc('a', 'Todo', 'todo.md', 'h', null, 'Todo')],
          remote('todo.md'),
        ),
      ).toEqual([])
    })

    it('holds a rename back while the listing is truncated', () => {
      expect(
        planPathMoves(CONNECTION, [], [doc('a', 'Todo', 'untitled.md')], {
          paths: new Set(['untitled.md']),
          truncated: true,
        }),
      ).toEqual([])
    })
  })
})

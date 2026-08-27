import { describe, it, expect } from 'vitest'
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'

import { buildArchiveEntries, archiveFilename, type ArchiveDocument } from './archive'

function doc(title: string, content = 'body', folderId: string | null = null): ArchiveDocument {
  return { title, content, folderId }
}

function paths(entries: ReturnType<typeof buildArchiveEntries>): string[] {
  return entries.map((entry) => entry.path)
}

describe('buildArchiveEntries', () => {
  it('files root documents at the top level and foldered ones under their folder', () => {
    const entries = buildArchiveEntries(
      [doc('Loose note'), doc('Inside', 'body', 'f1')],
      [{ id: 'f1', name: 'Course 2026' }],
    )
    expect(paths(entries).sort()).toEqual(['Course 2026/Inside.md', 'Loose note.md'])
  })

  it('carries each document’s content through unchanged', () => {
    const entries = buildArchiveEntries([doc('A', '# Heading\n\nBody')], [])
    expect(entries[0]).toEqual({ path: 'A.md', content: '# Heading\n\nBody' })
  })

  it('suffixes duplicate titles in the same folder, first one keeping the clean name', () => {
    const entries = buildArchiveEntries([doc('Notes'), doc('Notes'), doc('Notes')], [])
    expect(paths(entries)).toEqual(['Notes.md', 'Notes (2).md', 'Notes (3).md'])
  })

  it('suffixes titles that only collide AFTER sanitizing', () => {
    // Both sanitize to "A B" — a collision the titles themselves don't show.
    const entries = buildArchiveEntries([doc('A/B'), doc('A B')], [])
    expect(paths(entries)).toEqual(['A B.md', 'A B (2).md'])
  })

  it('treats names differing only in case as colliding', () => {
    // Distinct in a zip and on Linux, the same file on macOS/Windows —
    // extracting there would silently overwrite without this.
    const entries = buildArchiveEntries([doc('Notes'), doc('NOTES')], [])
    expect(paths(entries)).toEqual(['Notes.md', 'NOTES (2).md'])
  })

  it('does not let documents in different folders push each other to (2)', () => {
    const entries = buildArchiveEntries(
      [doc('Notes', 'a', 'f1'), doc('Notes', 'b', 'f2')],
      [
        { id: 'f1', name: 'One' },
        { id: 'f2', name: 'Two' },
      ],
    )
    expect(paths(entries)).toEqual(['One/Notes.md', 'Two/Notes.md'])
  })

  it('suffixes duplicate folder names', () => {
    const entries = buildArchiveEntries(
      [doc('A', 'a', 'f1'), doc('B', 'b', 'f2')],
      [
        { id: 'f1', name: 'Work' },
        { id: 'f2', name: 'Work' },
      ],
    )
    expect(paths(entries)).toEqual(['Work/A.md', 'Work (2)/B.md'])
  })

  it('emits a directory entry for a folder with no documents', () => {
    const entries = buildArchiveEntries([], [{ id: 'f1', name: 'Empty' }])
    expect(entries).toEqual([{ path: 'Empty/', content: '' }])
  })

  it('emits no directory entry for a folder that has documents', () => {
    const entries = buildArchiveEntries([doc('A', 'a', 'f1')], [{ id: 'f1', name: 'Full' }])
    expect(paths(entries)).toEqual(['Full/A.md'])
  })

  it('files a document with an unresolvable folder id at the root rather than dropping it', () => {
    const entries = buildArchiveEntries([doc('Orphan', 'body', 'gone')], [])
    expect(paths(entries)).toEqual(['Orphan.md'])
  })

  it('falls back to "untitled" for an empty or whitespace-only title', () => {
    const entries = buildArchiveEntries([doc(''), doc('   ')], [])
    expect(paths(entries)).toEqual(['untitled.md', 'untitled (2).md'])
  })

  it('never emits a path segment that could escape the extraction directory', () => {
    const entries = buildArchiveEntries(
      [doc('..'), doc('.', 'body', 'f1')],
      [{ id: 'f1', name: '..' }],
    )
    for (const path of paths(entries)) {
      expect(path.split('/')).not.toContain('..')
      expect(path.split('/')).not.toContain('.')
    }
  })

  it('strips characters that are illegal in filenames', () => {
    const entries = buildArchiveEntries([doc('a:b*c?d"e<f>g|h')], [])
    expect(paths(entries)[0]).toBe('a b c d e f g h.md')
  })
})

describe('the archive those entries produce', () => {
  it('round-trips through a real zip: every path and every byte survives', () => {
    const entries = buildArchiveEntries(
      [
        doc('Loose', '# Loose\n'),
        doc('Inside', 'folder body', 'f1'),
        doc('Inside', 'second body', 'f1'),
        doc('Unicode — “quoted” 🎉', 'unicode body'),
      ],
      [
        { id: 'f1', name: 'Course 2026' },
        { id: 'f2', name: 'Empty' },
      ],
    )

    const zipped = zipSync(
      Object.fromEntries(entries.map((entry) => [entry.path, strToU8(entry.content)])),
    )
    const unzipped = unzipSync(zipped)

    // Every file comes back with its content intact, including a non-ASCII
    // filename (zip stores names as bytes; without the UTF-8 flag set these
    // come back mojibaked).
    expect(strFromU8(unzipped['Loose.md'])).toBe('# Loose\n')
    expect(strFromU8(unzipped['Course 2026/Inside.md'])).toBe('folder body')
    expect(strFromU8(unzipped['Course 2026/Inside (2).md'])).toBe('second body')
    expect(strFromU8(unzipped['Unicode — “quoted” 🎉.md'])).toBe('unicode body')
    // The empty folder survives as a directory entry.
    expect(Object.keys(unzipped)).toContain('Empty/')
  })
})

describe('archiveFilename', () => {
  it('uses the LOCAL date, not UTC', () => {
    // 26 Aug 2026, 23:30 local. `toISOString()` would roll this to the 27th
    // for anyone east of UTC, dating the file a day ahead of the day they
    // are living in.
    expect(archiveFilename(new Date(2026, 7, 26, 23, 30))).toBe('powermd-2026-08-26.zip')
  })

  it('zero-pads single-digit months and days', () => {
    expect(archiveFilename(new Date(2026, 0, 5))).toBe('powermd-2026-01-05.zip')
  })
})

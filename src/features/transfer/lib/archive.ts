import { sanitizeFilename } from './filenames'

/** One document as the archive builder needs it: what to call the file,
 * what to put in it, and which folder it belongs under. Narrower than
 * `documents`' own `MarkdownDocument` for the same reason `ExportDocument`
 * is — this feature never needs a document's identity or timestamps. */
export interface ArchiveDocument {
  title: string
  content: string
  folderId: string | null
}

export interface ArchiveFolder {
  id: string
  name: string
}

export interface ArchiveEntry {
  /** POSIX-style path inside the archive. A trailing `/` marks a directory
   * entry with no file of its own — see `EMPTY FOLDERS` below. */
  path: string
  content: string
}

/**
 * Turns the whole workspace into the list of paths an archive should hold.
 * Pure and synchronous: no zipping, no Blob, no DOM — so every naming rule
 * below is unit-testable on its own, which matters because every one of
 * them is about a collision or a hostile name rather than the happy path.
 *
 * COLLISIONS. Document titles are free text, so two documents in one folder
 * can easily be called the same thing, and `sanitizeFilename` maps whole
 * classes of distinct titles onto one name ("A/B" and "A B" both become
 * "A B"). A zip may legally contain duplicate paths; extracting one is
 * where it goes wrong — most tools silently overwrite, so the user quietly
 * loses documents. Duplicates get " (2)", " (3)" suffixes instead, in input
 * order, so the first one keeps the clean name.
 *
 * CASE. That dedup is case-INSENSITIVE. "Notes.md" and "notes.md" are two
 * distinct entries as far as the zip format cares, and they survive as two
 * files on Linux — but macOS and Windows both have case-insensitive
 * filesystems by default, so extracting there silently overwrites again.
 * Deduping on the lowercased name is what makes the archive safe to extract
 * anywhere, at the cost of a " (2)" that looks unnecessary on Linux.
 *
 * PATH TRAVERSAL. A folder named ".." would otherwise produce paths like
 * `../secrets.md`. Plenty of extraction tools still write those relative to
 * the destination directory (the "zip slip" class of bug), so a segment
 * that sanitizes down to `.` or `..` is replaced outright rather than
 * escaped — this app should not be a source of hostile archives, even
 * though the only person who could plant such a name here is the user
 * themselves.
 *
 * EMPTY FOLDERS get a directory entry (trailing `/`, no content) so the
 * workspace's shape survives a round trip. Without it a folder the user
 * deliberately made and left empty would simply vanish from the archive.
 *
 * ORPHANS. A document whose `folderId` matches no folder lands at the root
 * rather than being dropped — the same defensive treatment
 * `DocumentDrawer.vue` already gives an unresolvable folder id. Losing a
 * document from a "download all" because of a dangling reference would be
 * far worse than filing it in the wrong place.
 */
export function buildArchiveEntries(
  documents: readonly ArchiveDocument[],
  folders: readonly ArchiveFolder[],
): ArchiveEntry[] {
  const usedDirNames = new Set<string>()
  const dirNameByFolderId = new Map<string, string>()

  for (const folder of folders) {
    const dirName = uniqueName(safeSegment(folder.name), usedDirNames)
    dirNameByFolderId.set(folder.id, dirName)
  }

  // One set of used filenames PER directory — `a/Notes.md` and `b/Notes.md`
  // do not collide, so they must not push each other to " (2)".
  const usedFileNamesByDir = new Map<string, Set<string>>()
  const entries: ArchiveEntry[] = []

  for (const doc of documents) {
    const dir = doc.folderId === null ? '' : (dirNameByFolderId.get(doc.folderId) ?? '')
    let used = usedFileNamesByDir.get(dir)
    if (used === undefined) {
      used = new Set<string>()
      usedFileNamesByDir.set(dir, used)
    }
    const base = uniqueName(`${safeSegment(doc.title)}.md`, used)
    entries.push({ path: dir === '' ? base : `${dir}/${base}`, content: doc.content })
  }

  // Directory entries for folders that ended up with no documents in them.
  for (const dirName of dirNameByFolderId.values()) {
    if (!usedFileNamesByDir.has(dirName)) {
      entries.push({ path: `${dirName}/`, content: '' })
    }
  }

  return entries
}

/** `sanitizeFilename` already strips characters illegal on the major
 * filesystems and falls back to "untitled" for an empty result. This adds
 * the two names that are legal characters-wise but mean something to a path
 * resolver rather than naming a file. */
function safeSegment(name: string): string {
  const sanitized = sanitizeFilename(name)
  return sanitized === '.' || sanitized === '..' ? 'untitled' : sanitized
}

/** Returns `name`, or the first free `name (n)`, and records the result.
 * Matching is case-insensitive; the returned name keeps its original case. */
function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name.toLowerCase())) {
    used.add(name.toLowerCase())
    return name
  }
  const dot = name.lastIndexOf('.')
  // A leading-dot name (".md") is all stem, no extension — same rule
  // `stripExtension` uses, so a suffix never lands before the dot there.
  const stem = dot <= 0 ? name : name.slice(0, dot)
  const ext = dot <= 0 ? '' : name.slice(dot)
  for (let n = 2; ; n += 1) {
    const candidate = `${stem} (${n})${ext}`
    if (!used.has(candidate.toLowerCase())) {
      used.add(candidate.toLowerCase())
      return candidate
    }
  }
}

/** `powermd-2026-08-26.zip` — dated so repeated downloads don't all land on
 * the same name in the Downloads folder. Local date parts, not
 * `toISOString()`: that is UTC, so someone downloading at 9pm on the 26th in
 * Berlin would get a file dated the 26th... but at 1am on the 27th they'd
 * get one dated the 26th too, which reads as wrong to them. */
export function archiveFilename(now: Date): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `powermd-${year}-${month}-${day}.zip`
}

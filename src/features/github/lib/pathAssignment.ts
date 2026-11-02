/**
 * Deterministic, pure, network-free assignment of GitHub sync paths to
 * documents and sync directories to folders.
 *
 * `assignPaths` gives a document or folder its first path. A document is
 * created as "Untitled" and gets that path at once, so its file name has to
 * be able to follow a later rename: `planPathMoves` works out which synced
 * documents were renamed or moved to another folder since their path was
 * named (`GitHubOrigin.placedAs`), and `model/sync.ts` moves each of them —
 * the new path and the removal of the old one in the same commit, so a
 * rename never leaves a duplicate behind. A path with no such record (synced
 * by an older version) is never moved.
 * Deleting a document locally still never deletes anything on GitHub.
 * Folders keep the directory they were first given; renaming a folder does
 * not move its files.
 */
import { slugify } from './slug'

export interface AssignmentConnection {
  owner: string
  repo: string
  branch: string
  /** Repo-root-relative prefix (already `normalizeSubfolder`-ed — no leading
   * or trailing slash), or `''` for the repo root. */
  subfolder: string
}

export interface AssignmentDoc {
  id: string
  title: string
  folderId: string | null
  /** Present and matching the active connection when this document already
   * owns a fixed path — such a document is left completely untouched. */
  origin: { owner: string; repo: string; branch: string; path: string } | null
}

export interface AssignmentFolder {
  id: string
  name: string
  /** Present when this folder already owns a fixed sync directory for *some*
   * connection — reused as-is only when it matches the active connection
   * (folders don't carry connection identity of their own the way
   * `GitHubOrigin` does, so "does this folder already have a dir path" is
   * all that's asked here; `model/sync.ts` only calls this for folders that
   * actually need one). */
  syncDirPath: string | null
}

export interface DocPathAssignment {
  id: string
  path: string
}

export interface FolderDirAssignment {
  id: string
  dirPath: string
}

export interface AssignPathsResult {
  /** Only the *newly* assigned folder directories — folders that already had
   * one are omitted entirely. */
  folderDirs: FolderDirAssignment[]
  /** Only the *newly* assigned document paths — documents that already had a
   * valid origin for `connection` are omitted entirely. */
  docPaths: DocPathAssignment[]
}

function originMatchesConnection(
  origin: AssignmentDoc['origin'],
  connection: AssignmentConnection,
): boolean {
  return (
    origin !== null &&
    origin.owner === connection.owner &&
    origin.repo === connection.repo &&
    origin.branch === connection.branch
  )
}

/** Slugifies each `/`-separated segment of a folder name independently and
 * rejoins them — a folder name is very unlikely to contain `/` (only
 * first-connect import produces one, and it seeds `syncDirPath` directly
 * rather than going through this function — see `resolveBulkImport` in
 * `features/documents`), but this keeps the function total and sane if it
 * ever does. */
function slugifyDirName(name: string): string {
  const slugged = name
    .split('/')
    .map((segment) => slugify(segment))
    .join('/')
  return slugged === '' ? 'folder' : slugged
}

/** Appends `-2`, `-3`, ... before the extension until `candidate` isn't in
 * `used`, then reserves and returns it. Deterministic given a stable
 * iteration order over the candidates being assigned in one batch — callers
 * sort their input by `id` before calling this to guarantee that. */
function dedupe(basePath: string, used: Set<string>): string {
  if (!used.has(basePath)) {
    used.add(basePath)
    return basePath
  }
  const dotIndex = basePath.lastIndexOf('.')
  const stem = dotIndex === -1 ? basePath : basePath.slice(0, dotIndex)
  const ext = dotIndex === -1 ? '' : basePath.slice(dotIndex)
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${stem}-${suffix}${ext}`
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
}

export function assignPaths(
  connection: AssignmentConnection,
  folders: AssignmentFolder[],
  docs: AssignmentDoc[],
): AssignPathsResult {
  const prefix = connection.subfolder === '' ? '' : `${connection.subfolder}/`

  // --- Folders: assign a dir path to every folder that doesn't have one,
  // deduped against every dir path already in use (existing + newly
  // assigned in this same pass). Processed in a stable `id` order so a batch
  // of simultaneously-unassigned same-named folders resolves the same way
  // regardless of the order the caller happened to list them in.
  const usedDirs = new Set(
    folders
      .filter((folder) => folder.syncDirPath !== null)
      .map((folder) => folder.syncDirPath as string),
  )
  const folderDirById = new Map(
    folders
      .filter((folder) => folder.syncDirPath !== null)
      .map((folder) => [folder.id, folder.syncDirPath as string]),
  )
  const folderDirs: FolderDirAssignment[] = []
  const foldersNeedingDirs = folders
    .filter((folder) => folder.syncDirPath === null)
    .sort((a, b) => a.id.localeCompare(b.id))
  for (const folder of foldersNeedingDirs) {
    const dirPath = dedupe(slugifyDirName(folder.name), usedDirs)
    folderDirs.push({ id: folder.id, dirPath })
    folderDirById.set(folder.id, dirPath)
  }

  // --- Documents: assign a path to every document that doesn't already have
  // a valid origin *for this connection*. Deduped against every path already
  // known to be in use under this connection (other documents' existing
  // origins) plus every path newly assigned in this same pass. Same stable
  // `id`-ordered processing as folders, for the same determinism reason.
  const usedPaths = new Set(
    docs
      .filter((doc) => originMatchesConnection(doc.origin, connection))
      .map((doc) => (doc.origin as NonNullable<AssignmentDoc['origin']>).path),
  )
  const docPaths: DocPathAssignment[] = []
  const docsNeedingPaths = docs
    .filter((doc) => !originMatchesConnection(doc.origin, connection))
    .sort((a, b) => a.id.localeCompare(b.id))
  for (const doc of docsNeedingPaths) {
    const dir = doc.folderId === null ? undefined : folderDirById.get(doc.folderId)
    const dirPrefix = dir === undefined ? prefix : `${prefix}${dir}/`
    const basePath = `${dirPrefix}${slugify(doc.title)}.md`
    docPaths.push({ id: doc.id, path: dedupe(basePath, usedPaths) })
  }

  return { folderDirs, docPaths }
}

export interface PlannedMove {
  id: string
  /** Where the document should live now. */
  path: string
  /** Whether the file at the document's current path is its own and should
   * be removed by the move. False when another document owns that path (two
   * documents claimed one file), so the move must leave it alone. */
  removeOld: boolean
}

/** What the branch holds, when known: every file path in the base tree, and
 * whether GitHub cut that listing short. */
export interface RemoteTree {
  paths: Set<string>
  truncated: boolean
}

export interface Placement {
  title: string
  folderId: string | null
}

export interface MoveDoc extends AssignmentDoc {
  origin:
    | (NonNullable<AssignmentDoc['origin']> & {
        syncedHash: string | null
        placedAs?: Placement | null
      })
    | null
}

function stemOf(filename: string): string {
  const index = filename.lastIndexOf('.')
  return index <= 0 ? filename : filename.slice(0, index)
}

/** Whether `path` is a fine name for a document titled `title` in
 * `dirPrefix`: the title itself (an imported file keeps its own name, e.g.
 * `My Notes.md`), or the slug the title would be assigned, possibly with a
 * `-N` suffix from deduplication. */
function pathFitsTitle(path: string, dirPrefix: string, title: string): boolean {
  if (!path.startsWith(dirPrefix)) return false
  const filename = path.slice(dirPrefix.length)
  if (filename.includes('/')) return false
  const stem = stemOf(filename)
  if (stem === title.trim()) return true
  const slug = slugify(title)
  // A slug holds only `[a-z0-9-]`, so it is safe inside a RegExp as-is.
  return stem === slug || new RegExp(`^${slug}-\\d+$`).test(stem)
}

/**
 * Which documents synced under `connection` should move, and where to.
 *
 * A document moves when it was renamed (typically away from "Untitled") or
 * moved to another folder since its path was named — `placedAs` differs from
 * its title and folder — and its path no longer fits the new title. A path
 * with no `placedAs` (synced by an older version) stays where it is,
 * whatever its name: no file is ever moved that nobody renamed. A document
 * also moves when another document holds the same path — a local document
 * assigned `notes.md` before the first-connect import found an existing
 * `notes.md` on GitHub. The document that has actually been pushed to the
 * path keeps it.
 *
 * Paths outside the connection's subfolder are left alone (synced under an
 * earlier subfolder of the same branch), as are documents in a folder that
 * has no directory yet (`assignPaths` gives it one first) or that this tab
 * does not know (another tab created it; moving to the root and removing the
 * old file would be wrong). Deterministic:
 * documents are processed in `id` order, and a new path is never one any
 * document currently holds, so a file is never removed and written in the
 * same commit.
 */
export function planPathMoves(
  connection: AssignmentConnection,
  folders: AssignmentFolder[],
  docs: MoveDoc[],
  /** The branch's files, or `null` when not fetched. When given, no new path
   * is ever one of them, and a document that has never been pushed moves off
   * a path a file already occupies — a file no local document owns (its
   * document was deleted here, or it was added on github.com), which the
   * push would otherwise overwrite. A truncated listing cannot confirm what
   * a rename would remove, so renames wait (and `model/sync.ts` holds first
   * pushes back too). */
  remote: RemoteTree | null = null,
): PlannedMove[] {
  const prefix = connection.subfolder === '' ? '' : `${connection.subfolder}/`
  const synced = docs
    .filter((doc) => originMatchesConnection(doc.origin, connection))
    .sort((a, b) => a.id.localeCompare(b.id))
  const pathOf = (doc: MoveDoc) => (doc.origin as NonNullable<MoveDoc['origin']>).path

  // One owner per path: the first document (in `id` order) that has been
  // pushed there, else simply the first document claiming it.
  const ownerByPath = new Map<string, MoveDoc>()
  for (const doc of synced) {
    const current = ownerByPath.get(pathOf(doc))
    if (
      current === undefined ||
      (current.origin?.syncedHash === null && doc.origin?.syncedHash !== null)
    ) {
      ownerByPath.set(pathOf(doc), doc)
    }
  }

  const used = new Set([...synced.map(pathOf), ...(remote?.paths ?? [])])
  const moves: PlannedMove[] = []
  for (const doc of synced) {
    const path = pathOf(doc)
    if (!path.startsWith(prefix)) continue

    let dirPrefix = prefix
    if (doc.folderId !== null) {
      const folder = folders.find((candidate) => candidate.id === doc.folderId)
      if (folder === undefined || folder.syncDirPath === null) continue
      dirPrefix = `${prefix}${folder.syncDirPath}/`
    }

    const ownsPath = ownerByPath.get(path) === doc
    const neverPushed = doc.origin?.syncedHash === null
    const occupiedRemotely = neverPushed && remote !== null && remote.paths.has(path)
    if (ownsPath && !occupiedRemotely) {
      const placedAs = doc.origin?.placedAs ?? null
      if (placedAs === null) continue
      if (placedAs.title === doc.title && placedAs.folderId === doc.folderId) continue
      if (pathFitsTitle(path, dirPrefix, doc.title)) continue
      if (remote?.truncated === true && !neverPushed) continue
    }

    moves.push({
      id: doc.id,
      path: dedupe(`${dirPrefix}${slugify(doc.title)}.md`, used),
      removeOld: ownsPath && !neverPushed,
    })
  }
  return moves
}

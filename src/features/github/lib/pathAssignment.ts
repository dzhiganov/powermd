/**
 * Deterministic, pure, network-free assignment of GitHub sync paths to
 * documents and sync directories to folders.
 *
 * This is the load-bearing piece of the "stable paths" design: because local
 * deletion never deletes remotely (see `model/sync.ts`'s doc comment), a
 * document's synced file can never be *moved* on GitHub — a move there is a
 * delete-plus-create, and deletes never happen. So the very first path ever
 * assigned to a document has to be the path it keeps forever; renaming or
 * refoldering a document locally must never cause a re-assignment, or the
 * old path is silently orphaned as a duplicate every time. This module is
 * only ever asked to assign a path to a document/folder that doesn't already
 * have one for the active connection — see `model/sync.ts`'s call site.
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

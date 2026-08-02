/** A GitHub repository, projected down from the raw REST JSON to just what
 * this feature needs (see `lib/api.ts`'s `listAllRepos`/`getRepo`). */
export interface GitHubRepo {
  id: number
  name: string
  /** `owner/name`, e.g. `octocat/hello-world`. */
  fullName: string
  owner: string
  defaultBranch: string
  private: boolean
}

/** One entry in a repository's recursive git tree, projected down from the
 * raw REST JSON (see `lib/api.ts`'s `getTree`). `path` is repo-root-relative
 * with `/` separators. `size` is present only for blobs. */
export interface GitHubTreeEntry {
  path: string
  type: 'blob' | 'tree'
  sha: string
  size?: number
}

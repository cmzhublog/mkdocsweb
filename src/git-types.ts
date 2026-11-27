export interface GitFile { path: string; content: string; sha: string; mode: string }
export interface GitRepository {
  id: string;
  owner: string;
  repo: string;
  branch: string;
  headSha: string;
  treeSha: string;
  rootFolderId: string;
  files: GitFile[];
  allPaths: string[];
}
export interface GitSnapshot { owner: string; repo: string; branch: string; headSha: string; treeSha: string; files: GitFile[]; allPaths: string[] }
export interface GitChange { path: string; kind: 'added' | 'modified' | 'deleted'; content?: string; mode: string }

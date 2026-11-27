export interface GitFile { path: string; content?: string; base64?: string; sha: string; mode: string; size?: number }
export interface GitRepository {
  id: string;
  owner: string;
  repo: string;
  branch: string;
  headSha: string;
  treeSha: string;
  rootFolderId: string;
  files: GitFile[];
  imageFiles?: GitFile[];
  allPaths: string[];
}
export interface GitSnapshot { owner: string; repo: string; branch: string; headSha: string; treeSha: string; files: GitFile[]; imageFiles?: GitFile[]; allPaths: string[] }
export interface GitChange { path: string; kind: 'added' | 'modified' | 'deleted'; content?: string; base64?: string; sha?: string; mode: string }

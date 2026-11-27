import { imageReference } from './images.ts';
import { APIError, gitFetch } from './api.ts';
import { ensureFolderPath, type Workspace, type Note } from './documents.ts';
import type { GitChange, GitFile, GitRepository, GitSnapshot } from './git-types';

export function parseCloneUrl(value: string): { owner: string; repo: string } {
  const raw = value.trim();
  const ssh = raw.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  let parts: string[];
  if (ssh) parts = [ssh[1], ssh[2]];
  else {
    let url: URL;
    try { url = new URL(raw); } catch { throw new Error('请输入 GitHub HTTPS 或 SSH clone 地址。'); }
    if (!['https:', 'ssh:'].includes(url.protocol) || url.hostname.toLowerCase() !== 'github.com' || url.port || url.password || url.search || url.hash || (url.protocol === 'https:' && url.username) || (url.protocol === 'ssh:' && url.username !== 'git')) throw new Error('仅支持 github.com 的仓库 clone 地址，请勿在地址中包含令牌。');
    parts = url.pathname.replace(/^\/|\/$/g, '').replace(/\.git$/i, '').split('/');
  }
  if (parts.length !== 2 || parts.some(p => !/^[\w.-]+$/.test(p) || p === '.' || p === '..')) throw new Error('仓库地址应为 https://github.com/用户名/仓库名.git');
  return { owner: parts[0], repo: parts[1] };
}

const isDocument = (path: string) => /\.(md|markdown|txt)$/i.test(path);
function validSegment(name: string) {
  return !!name.trim() && !/[\u0000-\u001f/\\]/.test(name) && !['.', '..', '.git'].includes(name.toLowerCase());
}

/** Return a path only for notes owned by this repository, excluding nested repo roots. */
export function repositoryPath(workspace: Workspace, repository: GitRepository, note: Note): string | null {
  const parts: string[] = [];
  let id = note.folderId;
  const seen = new Set<string>();
  while (id && id !== repository.rootFolderId) {
    if (seen.has(id) || workspace.repositories?.some(r => r.id !== repository.id && r.rootFolderId === id)) return null;
    seen.add(id);
    const folder = workspace.folders.find(f => f.id === id);
    if (!folder) return null;
    parts.unshift(folder.name); id = folder.parentId;
  }
  if (id !== repository.rootFolderId) return null;
  parts.push(`${note.title}${note.fileExtension ?? '.md'}`);
  if (parts.some(p => !validSegment(p))) throw new Error('仓库内的文件名或目录名无效，请检查空名称、斜杠或特殊路径。');
  return parts.join('/');
}

export function repositoryFiles(workspace: Workspace, repository: GitRepository): { path: string; content?: string; base64?: string; sha?: string; mode: string }[] {
  const paths = new Set<string>();
  const result = workspace.notes.flatMap<{ path: string; content?: string; base64?: string; sha?: string; mode: string }>(note => {
    const path = repositoryPath(workspace, repository, note);
    if (path === null) return [];
    if (paths.has(path)) throw new Error(`存在同名文件：${path}。请重命名后再 push。`);
    paths.add(path);
    if (note.remote) {
      if (note.remote.repositoryId !== repository.id) throw new Error(`请先打开跨仓库移动的文档，再提交：${path}`);
      const original = repository.files.find(f => f.sha === note.remote!.sha);
      return [{ path, sha: note.remote.sha, mode: original?.mode ?? '100644' }];
    }
    return [{ path, content: note.content, mode: repository.files.find(f => f.path === path)?.mode ?? '100644' }];
  });
  const trackedImages = new Set((workspace.images ?? []).filter(a => a.remote?.repositoryId === repository.id).map(a => a.remote!.path));
  for (const image of repository.imageFiles ?? []) {
    if (trackedImages.has(image.path)) continue;
    if (paths.has(image.path)) throw new Error(`图片与文档路径冲突：${image.path}`);
    paths.add(image.path); result.push({ path: image.path, sha: image.sha, mode: image.mode });
  }
  for (const asset of workspace.images ?? []) {
    const note = workspace.notes.find(n => n.id === asset.noteId); if (!note) continue;
    const notePath = repositoryPath(workspace, repository, note); if (notePath === null) continue;
    const parent = notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/') + 1) : '';
    const path = parent + imageReference(asset);
    if (paths.has(path)) throw new Error(`存在同名图片：${path}`);
    paths.add(path);
    result.push({ path, base64: asset.base64, mode: '100644', ...(asset.remote?.repositoryId === repository.id ? { sha: asset.remote.sha } : {}) });
  }
  const managedPaths = new Set([...repository.files, ...(repository.imageFiles ?? [])].map(f => f.path));
  const unmanaged = repository.allPaths.filter(path => !managedPaths.has(path));
  for (const file of result) {
    if (unmanaged.some(path => path === file.path || path.startsWith(`${file.path}/`) || file.path.startsWith(`${path}/`))) throw new Error(`路径与仓库中的其他文件冲突：${file.path}`);
    if (result.some(other => other.path !== file.path && other.path.startsWith(`${file.path}/`))) throw new Error(`文件与目录路径冲突：${file.path}`);
  }
  return result;
}

export function gitChanges(workspace: Workspace, repository: GitRepository): GitChange[] {
  const files = repositoryFiles(workspace, repository);
  const beforeFiles = [...repository.files, ...(repository.imageFiles ?? [])];
  const baseline = new Map(beforeFiles.map(f => [f.path, f]));
  return [
    ...files.flatMap(file => {
      const before = baseline.get(file.path);
      const same = before && ((file.sha !== undefined && before.sha === file.sha) || (file.content !== undefined && before.content === file.content));
      return !same ? [{ ...file, kind: before ? 'modified' as const : 'added' as const }] : [];
    }),
    ...beforeFiles.filter(before => !files.some(f => f.path === before.path)).map(before => ({ path: before.path, kind: 'deleted' as const, mode: before.mode })),
  ].sort((a, b) => a.path.localeCompare(b.path));
}

export function attachRepository(workspace: Workspace, snapshot: GitSnapshot): GitRepository {
  const id = crypto.randomUUID();
  // Repository roots always start independently from local folders and other repositories.
  const root = { id: crypto.randomUUID(), name: snapshot.repo, parentId: null, collapsed: false };
  workspace.folders.push(root);
  const repository = { ...snapshot, id, rootFolderId: root.id };
  (workspace.repositories ??= []).push(repository);
  applySnapshot(workspace, repository, snapshot);
  return repository;
}

export function applySnapshot(workspace: Workspace, repository: GitRepository, snapshot: GitSnapshot): void {
  const oldFolders = new Set(workspace.folders.map(f => f.id));
  if (workspace.images) workspace.images = workspace.images.filter(a => a.remote?.repositoryId !== repository.id || snapshot.imageFiles?.some(f => f.path === a.remote!.path && f.sha === a.remote!.sha));
  const cached = new Map(repository.files.filter(f => f.sha && f.content !== undefined).map(f => [f.sha, f.content!]));
  // Cache by immutable blob SHA. A new remote SHA never reuses stale text.
  const files = snapshot.files.map(file => ({ ...file, ...(file.content === undefined && cached.has(file.sha) ? { content: cached.get(file.sha)! } : {}) }));
  const existing = new Map(workspace.notes.flatMap(note => {
    const path = repositoryPath(workspace, repository, note);
    return path === null ? [] : [[path, note] as const];
  }));
  const currentPaths = new Set(files.map(f => f.path));
  workspace.notes = workspace.notes.filter(n => {
    const path = repositoryPath(workspace, repository, n);
    return path === null || currentPaths.has(path);
  });
  for (const file of files) {
    const parts = file.path.split('/'); const name = parts.pop()!;
    const extension = name.match(/\.(md|markdown|txt)$/i)![0];
    const folderId = ensureFolderPath(workspace, parts, repository.rootFolderId);
    const old = existing.get(file.path);
    const remote = file.content === undefined ? { repositoryId: repository.id, path: file.path, sha: file.sha } : undefined;
    if (old) { old.content = file.content ?? ''; old.remote = remote; old.updatedAt = Date.now(); }
    else workspace.notes.push({ id: crypto.randomUUID(), title: name.slice(0, -extension.length), fileExtension: extension, content: file.content ?? '', remote, folderId, updatedAt: Date.now() });
  }
  // Keep the initial tree compact even for repositories with thousands of documents.
  workspace.folders.forEach(folder => { if (!oldFolders.has(folder.id)) folder.collapsed = true; });
  if (workspace.images) workspace.images = workspace.images.filter(a => workspace.notes.some(n => n.id === a.noteId));
  repository.imageFiles = snapshot.imageFiles ?? [];
  repository.files = files; repository.allPaths = snapshot.allPaths;
  repository.headSha = snapshot.headSha; repository.treeSha = snapshot.treeSha;
}

export class GitHubClient {
  private token: string;
  private request: typeof fetch;
  private backend: boolean;
  constructor(token = '', request: typeof fetch = gitFetch) { this.token = token; this.request = request; this.backend = request === gitFetch; }

  private async api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.request(`https://api.github.com${path}`, {
        method, redirect: 'error', cache: 'no-store',
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000),
      });
    } catch (error) { if (error instanceof APIError) throw error; throw new Error('无法连接 GitHub，请检查网络。若刚执行 push，请先到 GitHub 确认结果再操作。'); }
    if (!response.ok) {
      if (response.status === 401) throw new Error('GitHub 令牌无效或已过期，请重新填写。');
      if (response.status === 403) throw new Error('GitHub 拒绝请求：请检查 API 配额、令牌 Contents 权限或分支保护规则。');
      if (response.status === 404) throw new Error('找不到仓库或分支；私有仓库需要具有访问权限的令牌。');
      if ([409, 422].includes(response.status)) throw new Error('GitHub 无法更新分支，可能存在远端新提交、空仓库或分支保护。未执行强制推送。');
      throw new Error(`GitHub 请求失败（${response.status}），请稍后重试。`);
    }
    return response.json() as Promise<T>;
  }

  private base(owner: string, repo: string) { return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`; }
  async head(owner: string, repo: string, branch: string): Promise<string> {
    const result = await this.api<{ object: { sha: string } }>(`${this.base(owner, repo)}/git/ref/heads/${encodeURIComponent(branch)}`);
    return result.object.sha;
  }
  async clone(url: string, requestedBranch = ''): Promise<GitSnapshot> {
    const { owner, repo } = parseCloneUrl(url);
    const base = this.base(owner, repo);
    const metadata = await this.api<{ default_branch: string }>(base);
    const branch = requestedBranch.trim() || metadata.default_branch;
    const headSha = await this.head(owner, repo, branch);
    const commit = await this.api<{ tree: { sha: string } }>(`${base}/git/commits/${headSha}`);
    const tree = await this.api<{ truncated: boolean; tree: { path: string; type: string; mode: string; sha: string; size?: number }[] }>(`${base}/git/trees/${commit.tree.sha}?recursive=1`);
    if (tree.truncated) throw new Error('仓库目录过大，GitHub 未返回完整文件树，已停止导入以免漏掉文档。');
    const entries = tree.tree.filter(e => e.type === 'blob');
    const docs = entries.filter(e => isDocument(e.path) && ['100644', '100755'].includes(e.mode));
    if (docs.some(e => e.path.split('/').some(part => !validSegment(part)))) throw new Error('仓库中有当前编辑器不支持的文件或目录名称，请先检查特殊路径字符。');
    const files: GitFile[] = docs.map(entry => ({ path: entry.path, sha: entry.sha, mode: entry.mode, size: entry.size }));
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { owner, repo, branch, headSha, treeSha: commit.tree.sha, files, imageFiles: entries.filter(e => /\.(png|jpe?g|gif|webp)$/i.test(e.path) && ['100644', '100755'].includes(e.mode)).map(e => ({ path: e.path, sha: e.sha, mode: e.mode, size: e.size })), allPaths: tree.tree.filter(e => e.type !== 'tree').map(e => e.path) };
  }

  async readFile(repository: Pick<GitRepository, 'owner' | 'repo'>, sha: string): Promise<string> {
    const blob = await this.api<{ encoding: string; content: string }>(`${this.base(repository.owner, repository.repo)}/git/blobs/${encodeURIComponent(sha)}`);
    if (blob.encoding !== 'base64') throw new Error('GitHub 返回的文档编码暂不支持。');
    try { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(blob.content.replace(/\s/g, '')), c => c.charCodeAt(0))); }
    catch { throw new Error('文档不是有效的 UTF-8，无法打开。'); }
  }

  async push(repository: GitRepository, changes: GitChange[], message: string): Promise<{ headSha: string; treeSha: string; blobs?: Record<string, string> }> {
    if (!this.token && !this.backend) throw new Error('push 需要具有仓库 Contents 读写权限的 GitHub 令牌。');
    if (!changes.length || !message.trim()) throw new Error('请先检查更改并填写提交说明。');
    const base = this.base(repository.owner, repository.repo);
    if (await this.head(repository.owner, repository.repo, repository.branch) !== repository.headSha) throw new Error('远端分支已有新提交，已停止 push。请先备份本地改动，与最新版本合并后再提交。');
    const blobs: Record<string, string> = {};
    for (const change of changes) {
      if (change.kind !== 'deleted' && change.base64 !== undefined) {
        blobs[change.path] = change.sha ?? (await this.api<{ sha: string }>(`${base}/git/blobs`, 'POST', { content: change.base64, encoding: 'base64' })).sha;
      }
    }
    const tree = await this.api<{ sha: string }>(`${base}/git/trees`, 'POST', {
      base_tree: repository.treeSha,
      tree: changes.map(c => ({ path: c.path, mode: c.mode, type: 'blob', ...(c.kind === 'deleted' ? { sha: null } : c.base64 !== undefined ? { sha: blobs[c.path] } : c.content !== undefined ? { content: c.content } : { sha: c.sha }) })),
    });
    const commit = await this.api<{ sha: string }>(`${base}/git/commits`, 'POST', { message: message.trim(), tree: tree.sha, parents: [repository.headSha] });
    try {
      await this.api(`${base}/git/refs/heads/${encodeURIComponent(repository.branch)}`, 'PATCH', { sha: commit.sha, force: false });
    } catch (error) {
      // A network failure can happen after GitHub has accepted the update.
      if (await this.head(repository.owner, repository.repo, repository.branch).catch(() => '') !== commit.sha) throw error;
    }
    return { headSha: commit.sha, treeSha: tree.sha, ...(Object.keys(blobs).length ? { blobs } : {}) };
  }
}

/** Deduplicate reads and hydrate only the selected note. Failed reads remain retryable. */
export class GitDocumentLoader {
  private pending = new Map<string, Promise<string>>();
  private workspace: Workspace;
  private clientFor: (repository: GitRepository) => GitHubClient;
  constructor(workspace: Workspace, clientFor: (repository: GitRepository) => GitHubClient) { this.workspace = workspace; this.clientFor = clientFor; }
  async load(noteId: string): Promise<void> {
    const note = this.workspace.notes.find(n => n.id === noteId);
    if (!note?.remote) return;
    const remote = note.remote;
    const repository = this.workspace.repositories?.find(r => r.id === remote.repositoryId);
    if (!repository) throw new Error('找不到文档所属仓库，请重新导入。');
    const baseline = repository.files.find(f => f.sha === remote.sha && f.content !== undefined);
    const key = `${repository.id}:${remote.sha}`;
    let content = baseline?.content;
    if (content === undefined) {
      let pending = this.pending.get(key);
      if (!pending) {
        pending = this.clientFor(repository).readFile(repository, remote.sha).finally(() => this.pending.delete(key));
        this.pending.set(key, pending);
      }
      content = await pending;
    }
    if (!this.workspace.notes.includes(note)) return;
    if (!note.remote) return;
    if (note.remote.sha !== remote.sha || note.remote.repositoryId !== remote.repositoryId) throw new Error('文档版本已更新，请重新打开以读取最新内容。');
    // Update every matching baseline so identical blobs can share the cached content.
    repository.files.forEach(file => { if (file.sha === remote.sha) file.content = content; });
    note.content = content;
    delete note.remote;
  }
}

import type { GitRepository } from './git-types';
export interface Note { id: string; title: string; content: string; updatedAt: number; folderId?: string | null; fileExtension?: string }
export interface Folder { id: string; name: string; parentId: string | null; collapsed: boolean }
export interface Workspace { notes: Note[]; activeId: string; folders: Folder[]; repositories?: GitRepository[] }
export const STORAGE_KEY = 'mkdocsweb.workspace.v1';
export function headings(markdown: string) {
  let fence = '';
  return markdown.split('\n').flatMap((line, index) => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) { if (!fence) fence = marker[1][0]; else if (fence === marker[1][0]) fence = ''; return []; }
    if (fence) return [];
    const match = line.match(/^(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/);
    return match ? [{ level: match[1].length, text: match[2].replace(/[*_`]/g, ''), line: index }] : [];
  });
}
export function parseWorkspace(raw: string | null): Workspace | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data.notes) || !data.notes.length || !data.notes.every((n: Note) => n && typeof n.id === 'string' && typeof n.title === 'string' && typeof n.content === 'string' && Number.isFinite(n.updatedAt)) || new Set(data.notes.map((n: Note) => n.id)).size !== data.notes.length) return null;
    const folders: Folder[] = data.folders ?? [];
    if (!Array.isArray(folders) || !folders.every(f => f && typeof f.id === 'string' && typeof f.name === 'string' && (f.parentId === null || typeof f.parentId === 'string') && typeof f.collapsed === 'boolean') || new Set(folders.map(f => f.id)).size !== folders.length) return null;
    const folderMap = new Map(folders.map(f => [f.id, f]));
    for (const folder of folders) {
      const seen = new Set([folder.id]);
      let parent = folder.parentId;
      while (parent !== null) {
        if (seen.has(parent) || !folderMap.has(parent)) return null;
        seen.add(parent); parent = folderMap.get(parent)!.parentId;
      }
    }
    if (data.notes.some((n: Note) => n.folderId != null && (typeof n.folderId !== 'string' || !folderMap.has(n.folderId)))) return null;
    if (data.notes.some((n: Note) => n.fileExtension !== undefined && (typeof n.fileExtension !== 'string' || !/^\.(md|markdown|txt)$/i.test(n.fileExtension)))) return null;
    const repositories: GitRepository[] | undefined = data.repositories;
    if (repositories !== undefined) {
      const validPath = (p: unknown) => typeof p === 'string' && p.length > 0 && !p.startsWith('/') && p.split('/').every(c => c !== '' && c !== '.' && c !== '..' && c !== '.git');
      if (!Array.isArray(repositories) || !repositories.every(r => r && typeof r.id === 'string' && typeof r.owner === 'string' && typeof r.repo === 'string' && /^[\w.-]+$/.test(r.owner) && /^[\w.-]+$/.test(r.repo) && typeof r.branch === 'string' && r.branch.length > 0 && /^[a-f\d]{40}$/i.test(r.headSha) && /^[a-f\d]{40}$/i.test(r.treeSha) && folderMap.has(r.rootFolderId) && Array.isArray(r.files) && r.files.every(f => f && validPath(f.path) && typeof f.content === 'string' && typeof f.sha === 'string' && ['100644', '100755'].includes(f.mode)) && new Set(r.files.map(f => f.path)).size === r.files.length && Array.isArray(r.allPaths) && r.allPaths.every(validPath))) return null;
      if (new Set(repositories.map(r => r.id)).size !== repositories.length || new Set(repositories.map(r => r.rootFolderId)).size !== repositories.length) return null;
    }
    return { notes: data.notes, folders, ...(repositories ? { repositories } : {}), activeId: data.notes.some((n: Note) => n.id === data.activeId) ? data.activeId : data.notes[0].id };
  } catch { return null; }
}
export function canMoveFolder(folders: Folder[], id: string, parentId: string | null): boolean {
  const map = new Map(folders.map(f => [f.id, f]));
  if (!map.has(id)) return false;
  const seen = new Set<string>();
  while (parentId !== null) {
    if (parentId === id || seen.has(parentId) || !map.has(parentId)) return false;
    seen.add(parentId); parentId = map.get(parentId)!.parentId;
  }
  return true;
}
export function ensureFolderPath(workspace: Workspace, parts: string[], parentId: string | null = null): string | null {
  for (const name of parts.filter(Boolean)) {
    let folder = workspace.folders.find(f => f.parentId === parentId && f.name === name);
    if (!folder) { folder = { id: crypto.randomUUID(), name, parentId, collapsed: false }; workspace.folders.push(folder); }
    parentId = folder.id;
  }
  return parentId;
}
export function mergeWorkspace(target: Workspace, source: Workspace): void {
  const ids = new Map(source.folders.map(f => [f.id, crypto.randomUUID()]));
  target.folders.push(...source.folders.map(f => ({ ...f, id: ids.get(f.id)!, parentId: f.parentId ? ids.get(f.parentId)! : null })));
  target.notes.push(...source.notes.map(note => ({ ...note, id: crypto.randomUUID(), folderId: note.folderId ? ids.get(note.folderId)! : null })));
  if (source.repositories?.length) (target.repositories ??= []).push(...source.repositories.map(r => ({ ...r, id: crypto.randomUUID(), rootFolderId: ids.get(r.rootFolderId)! })));
}
export function filename(title: string) { return (title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim() || '未命名文档').slice(0, 100); }
export function readingStats(content: string) {
  const characters = content.replace(/\s/g, '').length;
  return { characters, minutes: Math.max(1, Math.ceil(characters / 400)) };
}

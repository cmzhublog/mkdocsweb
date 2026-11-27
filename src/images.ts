import type { Note, Workspace } from './documents.ts';
import { filename } from './documents.ts';

export interface ImageAsset {
  id: string; noteId: string; folder: string; name: string; mime: string; base64: string;
  remote?: { repositoryId: string; path: string; sha: string };
}
export const imageExtensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
export function imageDirectory(note: Pick<Note, 'title'>) { return `${filename(note.title)}.assets`; }
export function imageReference(asset: ImageAsset) { return `${asset.folder}/${asset.name}`; }
export function markdownImagePath(path: string) { return path.split('/').map(part => encodeURIComponent(part).replace(/\(/g, '%28').replace(/\)/g, '%29')).join('/'); }
export function relativeImagePath(value: string): string | null {
  if (!value || /^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(value)) return null;
  try { const path = decodeURIComponent(value).replace(/^\.\//, ''); if (/[\u0000-\u001f\\]/.test(path) || path.split('/').some(p => !p)) return null; return path; } catch { return null; }
}
export function imageURL(userId: string, noteId: string, path: string, assetId?: string) {
  if (assetId) return `/api/images/${encodeURIComponent(userId)}/${encodeURIComponent(noteId)}?asset=${encodeURIComponent(assetId)}`;
  const relative = relativeImagePath(path);
  return relative === null ? path : `/api/images/${encodeURIComponent(userId)}/${encodeURIComponent(noteId)}?path=${encodeURIComponent(relative)}`;
}
export function imageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((b, i) => bytes[i] === b)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length));
  if (['GIF87a', 'GIF89a'].includes(ascii(0, 6))) return 'image/gif';
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
  return null;
}
export function decodeImage(base64: string) { return Uint8Array.from(atob(base64), c => c.charCodeAt(0)); }
export function validImageAsset(asset: ImageAsset, noteIds: Set<string>, repositoryIds: Set<string>): boolean {
  if (!asset || typeof asset.id !== 'string' || !asset.id || !noteIds.has(asset.noteId) || typeof asset.folder !== 'string' || !asset.folder.endsWith('.assets') || /[/\\\u0000-\u001f]/.test(asset.folder) || typeof asset.name !== 'string' || !asset.name || !/\.(png|jpe?g|gif|webp)$/i.test(asset.name) || /[/\\\u0000-\u001f]/.test(asset.name) || ['.', '..'].includes(asset.name) || !imageExtensions[asset.mime] || typeof asset.base64 !== 'string' || asset.base64.length > 28 * 1024 * 1024) return false;
  try { if (imageMime(decodeImage(asset.base64)) !== asset.mime) return false; } catch { return false; }
  return asset.remote === undefined || (!!asset.remote && repositoryIds.has(asset.remote.repositoryId) && typeof asset.remote.path === 'string' && !asset.remote.path.startsWith('/') && asset.remote.path.split('/').every(p => p && p !== '..' && p !== '.') && /^[a-f\d]{40}$/.test(asset.remote.sha));
}
export function encodeImage(bytes: Uint8Array) { let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(binary); }
export async function createImageAsset(note: Note, blob: Blob, originalName?: string): Promise<ImageAsset> {
  if (blob.size > 20 * 1024 * 1024) throw new Error('单张图片不能超过 20 MiB。');
  const bytes = new Uint8Array(await blob.arrayBuffer()); const mime = imageMime(bytes);
  if (!mime) throw new Error('请使用 PNG、JPEG、GIF 或 WebP 图片。');
  const id = crypto.randomUUID();
  return { id, noteId: note.id, folder: imageDirectory(note), name: originalName ?? `image-${Date.now()}-${id.slice(0, 8)}.${imageExtensions[mime]}`, mime, base64: encodeImage(bytes) };
}
/** Only rewrite links to this note's owned images; ordinary text and code stay unchanged. */
export function renameNoteImages(workspace: Workspace, note: Note) {
  const owned = workspace.images?.filter(a => a.noteId === note.id) ?? [];
  for (const asset of owned) {
    const old = imageReference(asset); asset.folder = imageDirectory(note); const next = imageReference(asset);
    if (old === next) continue;
    const spellings = new Set([old, markdownImagePath(old), `./${old}`, `./${markdownImagePath(old)}`]);
    let fence: { char: string; length: number } | null = null;
    note.content = note.content.split('\n').map(line => {
      const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (marker) { if (!fence) fence = { char: marker[1][0], length: marker[1].length }; else if (marker[1][0] === fence.char && marker[1].length >= fence.length) fence = null; return line; }
      if (fence || /^(?: {4}|\t)/.test(line)) return line;
      return line.split(/(`+[^`]*`+)/g).map((segment, index) => index % 2 ? segment : segment.replace(/(!\[[^\]\n]*\]\()(<[^>\n]*>|[^\s\n]*?)(\s+(?:"[^"\n]*"|'[^'\n]*'|\([^\n]*\)))?\)/g, (whole, start, target, title = '') => {
        const value = target.startsWith('<') ? target.slice(1, -1) : target;
        return spellings.has(value) ? `${start}${markdownImagePath(next)}${title})` : whole;
      })).join('');
    }).join('\n');
  }
}

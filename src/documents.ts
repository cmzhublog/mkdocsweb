export interface Note { id: string; title: string; content: string; updatedAt: number }
export interface Workspace { notes: Note[]; activeId: string }
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
    return { notes: data.notes, activeId: data.notes.some((n: Note) => n.id === data.activeId) ? data.activeId : data.notes[0].id };
  } catch { return null; }
}
export function filename(title: string) { return (title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim() || '未命名文档').slice(0, 100); }
export function readingStats(content: string) {
  const characters = content.replace(/\s/g, '').length;
  return { characters, minutes: Math.max(1, Math.ceil(characters / 400)) };
}

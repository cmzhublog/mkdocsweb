import { zipSync, strToU8 } from 'fflate';
import { filename, type Note, type Workspace } from './documents.ts';
import { decodeImage, imageDirectory, imageReference, relativeImagePath } from './images.ts';
import { repositoryPath } from './github.ts';

export async function documentArchive(workspace: Workspace, note: Note, readImage: (relative: string) => Promise<Uint8Array>): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = { [`${filename(note.title)}${note.fileExtension ?? '.md'}`]: strToU8(note.content) };
  for (const asset of workspace.images ?? []) if (asset.noteId === note.id) files[imageReference(asset)] = decodeImage(asset.base64);
  // Legacy repository connections have no imageFiles metadata yet. Include the
  // document's actual relative image links through the authenticated resolver.
  const references = new Set<string>(); let fence = '';
  for (const line of note.content.split('\n')) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) { fence = fence === marker[1][0] ? '' : fence || marker[1][0]; continue; }
    if (fence || /^(?: {4}|\t)/.test(line)) continue;
    for (const [index, segment] of line.split(/(`+[^`]*`+)/g).entries()) {
      if (index % 2) continue;
      for (const match of segment.matchAll(/!\[[^\]\n]*\]\((?:<([^>\n]+)>|([^\s)]+))/g)) {
        const relative = relativeImagePath(match[1] ?? match[2]);
        if (relative?.startsWith(imageDirectory(note) + '/') && relative.split('/').every(p => p !== '..' && p !== '.')) references.add(relative);
      }
    }
  }
  for (const relative of references) if (!files[relative]) files[relative] = await readImage(relative);
  for (const repository of workspace.repositories ?? []) {
    const docPath = repositoryPath(workspace, repository, note); if (docPath === null) continue;
    const parent = docPath.includes('/') ? docPath.slice(0, docPath.lastIndexOf('/') + 1) : '';
    const prefix = parent + imageDirectory(note) + '/';
    for (const image of repository.imageFiles ?? []) {
      if (!image.path.startsWith(prefix)) continue;
      const relative = image.path.slice(parent.length);
      if (!files[relative]) files[relative] = await readImage(relative);
    }
  }
  return zipSync(files, { level: 0 });
}

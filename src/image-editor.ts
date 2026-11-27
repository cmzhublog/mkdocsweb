import type { LinkMdNode, PluginInfo } from '@toast-ui/editor';
import type { Node } from 'prosemirror-model';
import { imageReference, imageURL, relativeImagePath } from './images.ts';
import type { Workspace } from './documents';

/** Display authenticated image URLs while keeping the Markdown node's relative URL. */
export function documentImages(userId: string, noteId: string, workspace: Workspace): () => PluginInfo {
  const resolve = (path: string) => imageURL(userId, noteId, path, workspace.images?.find(a => a.noteId === noteId && imageReference(a) === relativeImagePath(path))?.id);
  return () => ({
    toHTMLRenderers: {
      image(node, context) {
        if (!context.entering) return [];
        const alt = context.getChildrenText(node);
        context.skipChildren();
        return { type: 'openTag', tagName: 'img', selfClose: true, attributes: { src: resolve((node as LinkMdNode).destination ?? ''), alt } };
      },
    },
    wysiwygNodeViews: {
      image(node) {
        const dom = document.createElement('img');
        const update = (next: Node) => { if (next.type.name !== 'image') return false; const src = resolve(next.attrs.imageUrl); if (dom.getAttribute('src') !== src) dom.setAttribute('src', src); dom.alt = next.attrs.altText ?? ''; return true; };
        update(node);
        return { dom, update, ignoreMutation: () => true };
      },
    },
  });
}

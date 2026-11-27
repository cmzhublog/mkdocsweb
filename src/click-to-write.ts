import type { PluginContext } from '@toast-ui/editor';
import { TextSelection, type EditorState } from 'prosemirror-state';
import { closeHistory } from 'prosemirror-history';

/** Reuse a neighboring empty line; never change the surrounding blocks. */
export function lineAtBoundary(state: EditorState, position: number) {
  if (position < 0 || position > state.doc.content.size) return null;
  const boundary = state.doc.resolve(position);
  const paragraph = state.schema.nodes.paragraph;
  if (!paragraph) return null;
  let cursor = position + 1;
  if (boundary.nodeAfter?.type === paragraph && boundary.nodeAfter.content.size === 0) {
    return state.tr.setSelection(TextSelection.create(state.doc, cursor)).scrollIntoView();
  }
  if (boundary.nodeBefore?.type === paragraph && boundary.nodeBefore.content.size === 0) {
    cursor = position - boundary.nodeBefore.nodeSize + 1;
    return state.tr.setSelection(TextSelection.create(state.doc, cursor)).scrollIntoView();
  }
  if (!boundary.parent.canReplaceWith(boundary.index(), boundary.index(), paragraph)) return null;
  const tr = closeHistory(state.tr).insert(position, paragraph.create());
  return tr.setSelection(TextSelection.create(tr.doc, cursor)).scrollIntoView();
}

/** Whitespace anywhere in the writing pane can start a line in rich editing. */
export function clickToWrite({ pmState }: Pick<PluginContext, 'pmState'>) {
  return { wysiwygPlugins: [() => new pmState.Plugin({
    view(view) {
      const pane = view.dom.closest<HTMLElement>('.writing-pane') ?? document.querySelector<HTMLElement>('.writing-pane');
      const click = (event: MouseEvent) => {
        if (event.button || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.detail > 1 || event.defaultPrevented) return;
        if (!view.editable || !view.dom.getClientRects().length) return;
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest('button,input,textarea,select,a,dialog,.document-heading,.outline,.editor-bar,.toastui-editor-popup,.toastui-editor-code-block-language,.flow-node')) return;
        if (window.getSelection()?.isCollapsed === false) return;
        // Keep ordinary text/code clicks and SVG shapes/edges on their native path.
        const graph = target.closest('.flow-canvas');
        if (graph) {
          if (target !== graph && target.tagName.toLowerCase() !== 'svg') return;
        } else if (view.dom.contains(target) && target !== view.dom) {
          const shell = target.closest<HTMLElement>('.code-block-shell');
          if (target !== shell || event.clientY < shell.getBoundingClientRect().top + 48) return;
        }
        const blocks: {position:number;size:number;rect:DOMRect}[] = [];
        view.state.doc.forEach((node, position) => {
          const dom = view.nodeDOM(position);
          if (dom instanceof Element) blocks.push({ position, size:node.nodeSize, rect:dom.getBoundingClientRect() });
        });
        if (!blocks.length) return;
        let nearest = blocks[0], distance = Infinity;
        for (const block of blocks) {
          const d = event.clientY < block.rect.top ? block.rect.top-event.clientY : event.clientY > block.rect.bottom ? event.clientY-block.rect.bottom : 0;
          if (d < distance) { nearest=block; distance=d; }
        }
        const position = event.clientY < (nearest.rect.top+nearest.rect.bottom)/2 ? nearest.position : nearest.position+nearest.size;
        const tr = lineAtBoundary(view.state, position);
        if (!tr) return;
        event.preventDefault();
        view.dispatch(tr); view.focus();
      };
      pane?.addEventListener('click', click);
      return { destroy() { pane?.removeEventListener('click', click); } };
    },
  })] };
}

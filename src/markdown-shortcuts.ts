import type { PluginContext } from '@toast-ui/editor';
import { closeHistory } from 'prosemirror-history';

type ShortcutContext = Pick<PluginContext, 'pmState' | 'pmRules' | 'pmKeymap'>;

/** Markdown typing rules for the rich editor; source mode keeps literal Markdown. */
export function markdownShortcuts({ pmState, pmRules, pmKeymap }: ShortcutContext) {
  const { InputRule, inputRules, undoInputRule } = pmRules;
  const { Plugin } = pmState;
  const blockRule = new InputRule(/^(>|[-+*]|\d+[.)]) $/, (state, match, start, end) => {
    const { $from, empty } = state.selection;
    if (!empty || $from.parent.type.name !== 'paragraph') return null;
    if ($from.marks().some(m => m.type.name === 'code')) return null;
    const marker = match[1];
    const tr = state.tr.delete(start, end);
    const range = tr.doc.resolve(start).blockRange();
    if (!range) return null;
    const ordered = /^\d/.test(marker);
    const wrapper = state.schema.nodes[marker === '>' ? 'blockQuote' : ordered ? 'orderedList' : 'bulletList'];
    if (!range.parent.canReplaceWith(range.startIndex, range.endIndex, wrapper)) return null;
    if (marker === '>') return tr.wrap(range, [{ type: wrapper }]);
    return tr.wrap(range, [
      { type: wrapper, attrs: ordered ? { order: Number.parseInt(marker) } : undefined },
      { type: state.schema.nodes.listItem },
    ]);
  });

  const inlineRules = [
    { pattern: /(?<!\*)\*\*([^*\n]+)\*\*$/, mark: 'strong' },
    { pattern: /(?<!_)__([^_\n]+)__$/, mark: 'strong' },
    { pattern: /(?<!\*)\*([^*\n]+)\*$/, mark: 'emph' },
    { pattern: /(?<![\w_])_([^_\n]+)_$/, mark: 'emph' },
    { pattern: /(?<!`)`([^`\n]+)`$/, mark: 'code' },
    { pattern: /(?<!~)~~([^~\n]+)~~$/, mark: 'strike' },
  ].map(({ pattern, mark }) => new InputRule(pattern, (state, match, start, end) => {
    const { $from, empty } = state.selection;
    if (!empty || $from.marks().some(m => m.type.name === 'code')) return null;
    const prefix = $from.parent.textBetween(0, start - $from.start(), null, '\ufffc');
    if ((prefix.match(/\\+$/)?.[0].length ?? 0) % 2 === 1) return null;
    if (mark !== 'code' && ((prefix.match(/(?<!\\)`/g)?.length ?? 0) % 2 === 1)) return null;
    const type = state.schema.marks[mark];
    if (!type) return null;
    const content = match[1];
    return state.tr.insertText(content, start, end)
      .addMark(start, start + content.length, type.create())
      .removeStoredMark(type);
  }, { inCodeMark: false }));

  // After "- " has already become a list, "[ ] " or "[x] " makes it a task.
  const taskRule = new InputRule(/^\[([ xX])\] $/, (state, match, start, end) => {
    const { $from, empty } = state.selection;
    if (!empty || $from.depth < 2 || $from.parent.type.name !== 'paragraph') return null;
    const item = $from.node(-1);
    if (item.type.name !== 'listItem' || item.attrs.task) return null;
    return state.tr.delete(start, end).setNodeMarkup($from.before($from.depth - 1), undefined, {
      ...item.attrs, task: true, checked: match[1].toLowerCase() === 'x',
    });
  });

  const enterRules = new Plugin({
    props: {
      handleKeyDown(view, event) {
        if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || view.composing) return false;
        const { state } = view;
        const { $from, empty } = state.selection;
        if (!empty || $from.parentOffset !== $from.parent.content.size) return false;
        const text = $from.parent.textContent;
        if ($from.parent.type.name === 'codeBlock') {
          const lastNewline = text.lastIndexOf('\n');
          if (!/^(`{3,}|~{3,})\s*$/.test(text.slice(lastNewline + 1))) return false;
          const tr = state.tr.delete($from.start() + Math.max(0, lastNewline), $from.end());
          const afterCode = tr.mapping.map($from.after());
          tr.insert(afterCode, state.schema.nodes.paragraph.create());
          tr.setSelection(pmState.TextSelection.create(tr.doc, afterCode + 1));
          view.dispatch(tr.scrollIntoView());
          return true;
        }
        if ($from.parent.type.name !== 'paragraph') return false;
        const heading = text.match(/^(#{1,6})[ \t]+(\S.*)$/);
        if (heading) {
          const { schema } = state;
          if (!$from.node(-1).canReplaceWith($from.index(-1), $from.index(-1) + 1, schema.nodes.heading)) return false;
          const prefixLength = text.length - heading[2].length;
          const tr = closeHistory(state.tr).delete($from.start(), $from.start() + prefixLength);
          tr.setBlockType($from.start(), $from.start(), schema.nodes.heading, { level: heading[1].length });
          const afterHeading = tr.mapping.map($from.after());
          tr.insert(afterHeading, schema.nodes.paragraph.create());
          tr.setSelection(pmState.TextSelection.create(tr.doc, afterHeading + 1));
          tr.setStoredMarks([]);
          view.dispatch(tr.scrollIntoView());
          return true;
        }
        const fence = text.match(/^(`{3,}|~{3,})([\w+#.-]*)\s*$/);
        if (fence) {
          if (!$from.node(-1).canReplaceWith($from.index(-1), $from.index(-1) + 1, state.schema.nodes.codeBlock)) return false;
          const tr = state.tr.delete($from.start(), $from.end());
          tr.setBlockType($from.start(), $from.start(), state.schema.nodes.codeBlock, { language: fence[2] || null });
          view.dispatch(tr.scrollIntoView());
          return true;
        }
        if (/^(---+|\*\*\*+|___+)\s*$/.test(text)) {
          const { schema } = state;
          if (!$from.node(-1).canReplaceWith($from.index(-1), $from.index(-1) + 1, schema.nodes.thematicBreak)) return false;
          const tr = state.tr.replaceWith($from.before(), $from.after(), [
            schema.nodes.thematicBreak.create(), schema.nodes.paragraph.create(),
          ]);
          tr.setSelection(pmState.TextSelection.create(tr.doc, $from.before() + 2));
          view.dispatch(tr.scrollIntoView());
          return true;
        }
        return false;
      },
    },
  });

  return { wysiwygPlugins: [
    () => inputRules({ rules: [blockRule, taskRule, ...inlineRules] }),
    () => enterRules,
    () => pmKeymap.keymap({ Backspace: undoInputRule }),
  ] };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from 'prosemirror-model';
import { EditorState, Plugin, PluginKey, Selection, TextSelection } from 'prosemirror-state';
import { InputRule, inputRules, undoInputRule } from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import { markdownShortcuts } from '../src/markdown-shortcuts.ts';
import type { EditorView } from 'prosemirror-view';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    heading: { content: 'inline*', group: 'block', attrs: { level: { default: 1 } } },
    codeBlock: { content: 'text*', group: 'block', marks: '', code: true, attrs: { language: { default: null } } },
    blockQuote: { content: 'block+', group: 'block' },
    bulletList: { content: 'listItem+', group: 'block' },
    orderedList: { content: 'listItem+', group: 'block', attrs: { order: { default: 1 } } },
    listItem: { content: 'paragraph block*', attrs: { task: { default: false }, checked: { default: false } } },
    thematicBreak: { group: 'block' },
    restrictedCell: { group: 'block', content: 'paragraph+' },
    text: { group: 'inline' },
  },
  marks: { strong: {}, emph: {}, code: {}, strike: {} },
});

function harness(block = 'paragraph', initial = '', parent = 'doc') {
  const info = markdownShortcuts({
    pmState: { Plugin, PluginKey, Selection, TextSelection },
    pmRules: { InputRule, inputRules, undoInputRule }, pmKeymap: { keymap },
  });
  const plugins = info.wysiwygPlugins.map(make => make());
  const node = schema.node(block, null, initial ? [schema.text(initial)] : []);
  const doc = schema.node('doc', null, [parent === 'doc' ? node : schema.node(parent, null, node)]);
  const view = {
    state: EditorState.create({ schema, plugins, doc, selection: TextSelection.atEnd(doc) }),
    composing: false,
    dispatch(tr) { view.state = view.state.apply(tr); },
  } as EditorView;
  return {
    view,
    type(text: string) {
      for (const char of text) {
        const { from, to } = view.state.selection;
        const handled = plugins.some(plugin => plugin.props.handleTextInput?.call(plugin, view, from, to, char, () => view.state.tr.insertText(char)));
        if (!handled) view.dispatch(view.state.tr.insertText(char));
      }
    },
    enter(composing = false) {
      return plugins.some(plugin => plugin.props.handleKeyDown?.call(plugin, view, { key: 'Enter', isComposing: composing } as KeyboardEvent));
    },
  };
}

test('输入 # 至 ###### 加空格创建相应级别标题，退格可撤回', () => {
  for (let level = 1; level <= 6; level++) {
    const h = harness(); h.type('#'.repeat(level) + ' ');
    assert.equal(h.view.state.doc.firstChild?.type.name, 'heading');
    assert.equal(h.view.state.doc.firstChild?.attrs.level, level);
    assert.equal(undoInputRule(h.view.state, tr => h.view.dispatch(tr)), true);
    assert.equal(h.view.state.doc.textContent, '#'.repeat(level) + ' ');
  }
  const h = harness(); h.type('####### ');
  assert.equal(h.view.state.doc.firstChild?.type.name, 'paragraph');
});
test('代码围栏在回车后创建代码块，保留语言；代码内不转换 Markdown', () => {
  const h = harness(); h.type('```typescript'); assert.equal(h.enter(), true);
  assert.equal(h.view.state.doc.firstChild?.type.name, 'codeBlock');
  assert.equal(h.view.state.doc.firstChild?.attrs.language, 'typescript');
  h.type('## **原样代码**');
  assert.equal(h.view.state.doc.textContent, '## **原样代码**');
  assert.equal(h.view.state.doc.firstChild?.firstChild?.marks.length, 0);
  const tilde = harness(); tilde.type('~~~'); tilde.enter();
  assert.equal(tilde.view.state.doc.firstChild?.type.name, 'codeBlock');
});
test('中文输入法组合阶段不触发规则', () => {
  const h = harness(); h.view.composing = true; h.type('## ');
  assert.equal(h.view.state.doc.firstChild?.type.name, 'paragraph');
  const fence = harness('paragraph', '```js');
  assert.equal(fence.enter(true), false);
});
test('结束围栏退出代码块，后续文字在普通段落输入', () => {
  const h = harness(); h.type('```js'); h.enter(); h.type('const x = 1;\n```');
  assert.equal(h.enter(), true);
  assert.equal(h.view.state.doc.firstChild?.textContent, 'const x = 1;');
  assert.equal(h.view.state.selection.$from.parent.type.name, 'paragraph');
  h.type('后续正文');
  assert.equal(h.view.state.doc.lastChild?.textContent, '后续正文');
});
test('行内代码、加粗、斜体与删除线自动转换并结束当前标记', () => {
  for (const [text, mark] of [['`代码`', 'code'], ['**加粗**', 'strong'], ['__加粗__', 'strong'], ['*斜体*', 'emph'], ['_斜体_', 'emph'], ['~~删除~~', 'strike']]) {
    const h = harness(); h.type(text);
    assert.equal(h.view.state.doc.firstChild?.firstChild?.marks[0]?.type.name, mark);
    assert.equal(h.view.state.doc.textContent, text.replace(/[`*_~]/g, ''));
    h.type('后续');
    assert.equal(h.view.state.doc.firstChild?.lastChild?.marks.length, 0);
  }
  const h = harness(); h.type('`**保持原样**`');
  assert.equal(h.view.state.doc.textContent, '**保持原样**');
  assert.equal(h.view.state.doc.firstChild?.firstChild?.marks[0]?.type.name, 'code');
  const escaped = harness(); escaped.type('\\**原样文字**');
  assert.equal(escaped.view.state.doc.textContent, '\\**原样文字**');
});
test('列表、任务列表与引用通过行首语法创建', () => {
  for (const [text, type] of [['- ', 'bulletList'], ['* ', 'bulletList'], ['3. ', 'orderedList'], ['> ', 'blockQuote']]) {
    const h = harness(); h.type(text);
    assert.equal(h.view.state.doc.firstChild?.type.name, type);
    if (type === 'orderedList') assert.equal(h.view.state.doc.firstChild?.attrs.order, 3);
  }
  for (const checked of [false, true]) {
    const h = harness(); h.type(checked ? '- [x] ' : '- [ ] ');
    const item = h.view.state.doc.firstChild?.firstChild;
    assert.equal(item?.attrs.task, true); assert.equal(item?.attrs.checked, checked);
  }
});
test('分隔线回车后留在新段落，普通文本中的符号不触发块转换', () => {
  const h = harness(); h.type('---'); h.enter();
  assert.equal(h.view.state.doc.firstChild?.type.name, 'thematicBreak');
  assert.equal(h.view.state.selection.$from.parent.type.name, 'paragraph');
  const ordinary = harness(); ordinary.type('内容 ## 标题');
  assert.equal(ordinary.view.state.doc.firstChild?.type.name, 'paragraph');
});
test('受限单元格不允许的块格式保留原始字符，不损坏文档', () => {
  for (const text of ['## ', '> ', '- ']) {
    const h = harness('paragraph', '', 'restrictedCell'); h.type(text);
    assert.equal(h.view.state.doc.textContent, text);
  }
  const h = harness('paragraph', '```js', 'restrictedCell');
  assert.equal(h.enter(), false);
  assert.equal(h.view.state.doc.textContent, '```js');
});

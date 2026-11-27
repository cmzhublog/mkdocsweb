import test from 'node:test';
import assert from 'node:assert/strict';
import { canMoveFolder, ensureFolderPath, mergeWorkspace, headings, parseWorkspace, filename, readingStats, type Workspace } from '../src/documents.ts';

test('损坏或异常的备份不会被当作有效文档恢复', () => {
  for (const raw of [null, '{', '{}', '{"notes":[]}', '{"notes":[{"title":"x"}]}']) assert.equal(parseWorkspace(raw), null);
  const note = { id: 'a', title: '测试', content: '# 内容', updatedAt: 123 };
  assert.deepEqual(parseWorkspace(JSON.stringify({ notes: [note], activeId: 'deleted' })), { notes: [note], folders: [], activeId: 'a' });
  assert.equal(parseWorkspace(JSON.stringify({ notes: [note, note], activeId: 'a' })), null);
});
test('文件夹路径可重用并保留多层目录，移动时禁止循环', () => {
  const workspace: Workspace = { notes: [], folders: [], activeId: '' };
  const leaf = ensureFolderPath(workspace, ['项目', '笔记', '资料']);
  assert.equal(ensureFolderPath(workspace, ['项目', '笔记', '资料']), leaf);
  assert.equal(workspace.folders.length, 3);
  assert.equal(workspace.folders[2].parentId, workspace.folders[1].id);
  assert.equal(canMoveFolder(workspace.folders, workspace.folders[0].id, leaf), false);
  assert.equal(canMoveFolder(workspace.folders, leaf!, leaf), false);
  assert.equal(canMoveFolder(workspace.folders, leaf!, 'missing'), false);
  assert.equal(canMoveFolder(workspace.folders, leaf!, null), true);
});
test('损坏的目录关系不被恢复，合法层级可往返保存', () => {
  const note = { id: 'n', title: '文件', content: '', updatedAt: 1, folderId: 'b' };
  const a = { id: 'a', name: '项目', parentId: null, collapsed: false };
  const b = { id: 'b', name: '笔记', parentId: 'a', collapsed: true };
  const data = { notes: [note], folders: [a, b], activeId: 'n' };
  assert.deepEqual(parseWorkspace(JSON.stringify(data)), data);
  for (const folders of [[a], [a, { ...b, parentId: 'missing' }], [{ ...a, parentId: 'b' }, b], [a, a, b]]) {
    assert.equal(parseWorkspace(JSON.stringify({ ...data, folders })), null);
  }
});
test('合并备份重映射全部目录和文档 ID，不覆盖已有内容', () => {
  const source: Workspace = { notes: [{ id: 'n', title: '文件', content: '原文', updatedAt: 1, folderId: 'b' }], folders: [{ id: 'a', name: '项目', parentId: null, collapsed: false }, { id: 'b', name: '笔记', parentId: 'a', collapsed: false }], activeId: 'n' };
  const target = structuredClone(source);
  mergeWorkspace(target, source); mergeWorkspace(target, source);
  assert.equal(target.notes.length, 3); assert.equal(target.folders.length, 6);
  assert.equal(new Set(target.notes.map(n => n.id)).size, 3);
  assert.equal(new Set(target.folders.map(f => f.id)).size, 6);
  assert.equal(target.notes[0].content, '原文');
  assert.ok(parseWorkspace(JSON.stringify(target)));
  assert.notEqual(target.notes[1].folderId, source.notes[0].folderId);
});
test('大纲忽略代码块中的伪标题并保留层级', () => {
  const result = headings('# 标题\n```md\n## 这不是标题\n```\n## **小节**\n~~~\n# code\n~~~\n### 尾声 ###');
  assert.deepEqual(result.map(({ level, text }) => ({ level, text })), [{ level: 1, text: '标题' }, { level: 2, text: '小节' }, { level: 3, text: '尾声' }]);
});
test('导出文件名兼容操作系统并提供空标题回退', () => {
  assert.equal(filename('a/b:c?.md'), 'a-b-c-.md');
  assert.equal(filename('   '), '未命名文档');
});
test('字符与阅读时间适用于中文文本', () => {
  assert.deepEqual(readingStats('你好 世界\n'), { characters: 4, minutes: 1 });
  assert.equal(readingStats('字'.repeat(801)).minutes, 3);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { headings, parseWorkspace, filename, readingStats } from '../src/documents.ts';

test('损坏或异常的备份不会被当作有效文档恢复', () => {
  for (const raw of [null, '{', '{}', '{"notes":[]}', '{"notes":[{"title":"x"}]}']) assert.equal(parseWorkspace(raw), null);
  const note = { id: 'a', title: '测试', content: '# 内容', updatedAt: 123 };
  assert.deepEqual(parseWorkspace(JSON.stringify({ notes: [note], activeId: 'deleted' })), { notes: [note], activeId: 'a' });
  assert.equal(parseWorkspace(JSON.stringify({ notes: [note, note], activeId: 'a' })), null);
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

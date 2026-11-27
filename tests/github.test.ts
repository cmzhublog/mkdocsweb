import test from 'node:test';
import assert from 'node:assert/strict';
import { applySnapshot, attachRepository, GitHubClient, gitChanges, parseCloneUrl, repositoryFiles } from '../src/github.ts';
import { mergeWorkspace, parseWorkspace, type Workspace } from '../src/documents.ts';
import type { GitSnapshot } from '../src/git-types.ts';

const sha = (n: number) => n.toString(16).padStart(40, '0');
function snapshot(): GitSnapshot {
  return { owner: 'demo', repo: 'notes', branch: 'main', headSha: sha(1), treeSha: sha(2), files: [
    { path: 'docs/你好.MD', content: '# 中文\n', sha: sha(3), mode: '100755' },
    { path: 'README.md', content: '说明\n', sha: sha(4), mode: '100644' },
  ], allPaths: ['docs/你好.MD', 'README.md', 'image.png', 'excluded.md', 'config.json'] };
}
function workspace(): Workspace { return { folders: [], notes: [{ id: 'local', title: '本地文件', content: '不上传', updatedAt: 1 }], activeId: 'local' }; }
type Call = { path: string; method: string; body: any; options: RequestInit };
function mock(handler: (call: Call, calls: Call[]) => unknown | Response) {
  const calls: Call[] = [];
  const request = (async (input: string | URL | Request, options: RequestInit = {}) => {
    const call = { path: new URL(String(input)).pathname + new URL(String(input)).search, method: options.method ?? 'GET', body: options.body ? JSON.parse(String(options.body)) : undefined, options };
    calls.push(call); const value = handler(call, calls);
    return value instanceof Response ? value : Response.json(value);
  }) as typeof fetch;
  return { calls, request };
}

test('接受 GitHub HTTPS/SSH clone 地址，拒绝带凭据和任意服务地址', () => {
  for (const url of ['https://github.com/demo/notes.git', 'https://github.com/demo/notes/', 'git@github.com:demo/notes.git', 'ssh://git@github.com/demo/notes.git']) assert.deepEqual(parseCloneUrl(url), { owner: 'demo', repo: 'notes' });
  for (const url of ['https://evil.test/demo/notes', 'https://token@github.com/demo/notes.git', 'https://github.com/demo/notes/tree/main', 'file:///tmp/repo', 'https://github.com/demo/notes?token=x', 'https://github.com.evil.test/demo/notes', 'https://github.com/../repo']) assert.throws(() => parseCloneUrl(url));
});
test('导入保留目录、扩展名和原文；仅仓库内文件进入更改清单', () => {
  const w = workspace(); const r = attachRepository(w, snapshot());
  assert.deepEqual(gitChanges(w, r), []);
  const note = w.notes.find(n => n.title === '你好')!;
  assert.equal(note.fileExtension, '.MD');
  note.content = '# 修改';
  assert.deepEqual(gitChanges(w, r), [{ path: 'docs/你好.MD', content: '# 修改', mode: '100755', kind: 'modified' }]);
  note.title = '新标题';
  const changes = gitChanges(w, r);
  assert.equal(changes.find(c => c.path === 'docs/你好.MD')?.kind, 'deleted');
  assert.equal(changes.find(c => c.path === 'docs/新标题.MD')?.kind, 'added');
  assert.ok(!JSON.stringify(changes).includes('不上传'));
});
test('重复文件名、受保护的未导入文件和路径冲突会阻止提交', () => {
  const w = workspace(); const r = attachRepository(w, snapshot());
  const n = w.notes.find(n => n.title === 'README')!;
  w.notes.push({ ...n, id: 'duplicate' });
  assert.throws(() => repositoryFiles(w, r), /同名/);
  w.notes.pop(); n.title = 'excluded';
  assert.throws(() => repositoryFiles(w, r), /冲突/);
  n.title = '../invalid';
  assert.throws(() => repositoryFiles(w, r), /无效/);
});
test('嵌套连接仓库不会把另一仓库的文档上传到父仓库', () => {
  const w = workspace(); const parent = attachRepository(w, snapshot());
  const child = attachRepository(w, { ...snapshot(), repo: 'other' });
  w.folders.find(f => f.id === child.rootFolderId)!.parentId = parent.rootFolderId;
  assert.equal(repositoryFiles(w, parent).length, 2);
  assert.equal(repositoryFiles(w, child).length, 2);
});
test('拉取保留相同路径文档 ID，处理远端新增与删除', () => {
  const w = workspace(); const r = attachRepository(w, snapshot());
  const id = w.notes.find(n => n.title === '你好')!.id;
  const next = snapshot(); next.headSha = sha(20); next.files = [{ ...next.files[0], content: '远端新版本' }, { path: 'new.txt', content: '新增', mode: '100644', sha: sha(9) }];
  applySnapshot(w, r, next);
  assert.equal(w.notes.find(n => n.id === id)?.content, '远端新版本');
  assert.equal(w.notes.some(n => n.title === 'README'), false);
  assert.equal(w.notes.find(n => n.title === 'new')?.fileExtension, '.txt');
  assert.equal(w.notes.find(n => n.id === 'local')?.content, '不上传');
  assert.deepEqual(gitChanges(w, r), []);
});
test('仓库元信息可备份恢复，合并时重新映射仓库根目录', () => {
  const source = workspace(); attachRepository(source, snapshot());
  assert.ok(parseWorkspace(JSON.stringify(source)));
  const target = workspace(); mergeWorkspace(target, source);
  assert.notEqual(target.repositories![0].rootFolderId, source.repositories![0].rootFolderId);
  assert.ok(parseWorkspace(JSON.stringify(target)));
  const bad = structuredClone(source); bad.repositories![0].rootFolderId = 'missing';
  assert.equal(parseWorkspace(JSON.stringify(bad)), null);
  assert.ok(!JSON.stringify(target).includes('Authorization'));
});
test('GitHub 导入按提交读取 UTF-8 文档，跳过图片和符号链接', async () => {
  const m = mock(call => {
    if (call.path === '/repos/demo/notes') return { default_branch: 'feature/docs' };
    if (call.path.includes('/git/ref/')) return { object: { sha: sha(1) } };
    if (call.path.includes('/git/commits/')) return { tree: { sha: sha(2) } };
    if (call.path.includes('/git/trees/')) return { truncated: false, tree: [
      { path: '目录/中文.md', mode: '100644', type: 'blob', sha: sha(3), size: 20 },
      { path: 'image.png', mode: '100644', type: 'blob', sha: sha(4), size: 20 },
      { path: 'link.md', mode: '120000', type: 'blob', sha: sha(5), size: 20 },
    ] };
    if (call.path.endsWith(`/git/blobs/${sha(3)}`)) return { encoding: 'base64', content: Buffer.from('中文内容\n').toString('base64') };
    throw new Error(`Unexpected request ${call.path}`);
  });
  const result = await new GitHubClient('', m.request).clone('git@github.com:demo/notes.git');
  assert.equal(result.files.length, 1); assert.equal(result.files[0].content, '中文内容\n');
  assert.equal(result.branch, 'feature/docs');
  assert.ok(m.calls.some(c => c.path.includes('feature%2Fdocs')));
  assert.ok(m.calls.every(c => !(c.options.headers as any).Authorization));
});
test('push 创建基于原树的单次提交，保留其他文件且禁用强推', async () => {
  const w = workspace(); const r = attachRepository(w, snapshot());
  w.notes.find(n => n.title === '你好')!.content = '新内容';
  w.notes = w.notes.filter(n => n.title !== 'README');
  const m = mock(call => {
    if (call.method === 'GET') return { object: { sha: sha(1) } };
    if (call.path.endsWith('/git/trees')) return { sha: sha(10) };
    if (call.path.endsWith('/git/commits')) return { sha: sha(11) };
    if (call.method === 'PATCH') return { object: { sha: sha(11) } };
    throw new Error('Unexpected request');
  });
  assert.deepEqual(await new GitHubClient('test-only-token', m.request).push(r, gitChanges(w, r), '更新文档'), { headSha: sha(11), treeSha: sha(10) });
  const tree = m.calls.find(c => c.path.endsWith('/git/trees'))!.body;
  assert.equal(tree.base_tree, sha(2));
  assert.equal(tree.tree.find((entry: any) => entry.path === 'README.md').sha, null);
  assert.ok(!JSON.stringify(tree).includes('image.png'));
  assert.deepEqual(m.calls.find(c => c.path.endsWith('/git/commits'))!.body.parents, [sha(1)]);
  assert.deepEqual(m.calls.find(c => c.method === 'PATCH')!.body, { sha: sha(11), force: false });
  assert.ok(m.calls.every(c => c.options.redirect === 'error'));
  assert.ok(!JSON.stringify(w).includes('test-only-token'));
});
test('远端冲突在写入前停止；拒绝未授权 push', async () => {
  const w = workspace(); const r = attachRepository(w, snapshot());
  w.notes.find(n => n.title === 'README')!.content = '修改';
  const m = mock(() => ({ object: { sha: sha(999) } }));
  await assert.rejects(new GitHubClient('test-only', m.request).push(r, gitChanges(w, r), '更新'), /远端分支已有新提交/);
  assert.equal(m.calls.length, 1); assert.equal(m.calls[0].method, 'GET');
  await assert.rejects(new GitHubClient('', m.request).push(r, gitChanges(w, r), '更新'), /令牌/);
  assert.equal(m.calls.length, 1);
});
test('远端在提交期间发生变化时不更新本地基线、不强推', async () => {
  const w = workspace(); const r = attachRepository(w, snapshot());
  w.notes.find(n => n.title === 'README')!.content = '修改';
  let reads = 0;
  const m = mock(call => {
    if (call.method === 'GET') return { object: { sha: reads++ ? sha(500) : sha(1) } };
    if (call.path.endsWith('/git/trees')) return { sha: sha(10) };
    if (call.path.endsWith('/git/commits')) return { sha: sha(11) };
    return Response.json({}, { status: 422 });
  });
  await assert.rejects(new GitHubClient('test-only', m.request).push(r, gitChanges(w, r), '更新'), /无法更新分支/);
  assert.equal(r.headSha, sha(1));
  assert.ok(m.calls.filter(c => c.method === 'PATCH').every(c => c.body.force === false));
});
test('拒绝截断文件树和超限文档，避免不完整导入', async () => {
  const m = mock(call => {
    if (call.path === '/repos/demo/notes') return { default_branch: 'main' };
    if (call.path.includes('/git/ref/')) return { object: { sha: sha(1) } };
    if (call.path.includes('/git/commits/')) return { tree: { sha: sha(2) } };
    return { truncated: true, tree: [] };
  });
  await assert.rejects(new GitHubClient('', m.request).clone('https://github.com/demo/notes.git'), /完整文件树/);
  assert.equal(m.calls.filter(c => c.path.includes('/git/blobs/')).length, 0);
  const oversized = mock(call => {
    if (call.path === '/repos/demo/notes') return { default_branch: 'main' };
    if (call.path.includes('/git/ref/')) return { object: { sha: sha(1) } };
    if (call.path.includes('/git/commits/')) return { tree: { sha: sha(2) } };
    return { truncated: false, tree: [{ path: 'large.md', type: 'blob', mode: '100644', sha: sha(3), size: 3 * 1024 * 1024 }] };
  });
  await assert.rejects(new GitHubClient('', oversized.request).clone('https://github.com/demo/notes.git'), /2 MB/);
  assert.equal(oversized.calls.filter(c => c.path.includes('/git/blobs/')).length, 0);
});
test('更新分支后响应丢失，通过只读核实避免重复提交', async () => {
  const w = workspace(); const r = attachRepository(w, snapshot());
  w.notes.find(n => n.title === 'README')!.content = '修改';
  let updated = false;
  const m = mock(call => {
    if (call.method === 'GET') return { object: { sha: updated ? sha(11) : sha(1) } };
    if (call.path.endsWith('/git/trees')) return { sha: sha(10) };
    if (call.path.endsWith('/git/commits')) return { sha: sha(11) };
    updated = true; throw new TypeError('simulated lost response');
  });
  const result = await new GitHubClient('test-only', m.request).push(r, gitChanges(w, r), '更新');
  assert.equal(result.headSha, sha(11));
  assert.equal(m.calls.filter(c => c.method === 'PATCH').length, 1);
});

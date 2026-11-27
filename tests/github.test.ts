import test from 'node:test';
import assert from 'node:assert/strict';
import { applySnapshot, attachRepository, GitHubClient, GitDocumentLoader, gitChanges, parseCloneUrl, repositoryFiles } from '../src/github.ts';
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
function lazySnapshot(): GitSnapshot { return { ...snapshot(), files: snapshot().files.map(({ content, ...file }) => file) }; }
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
test('导入只读取目录，点击文件时才读取 UTF-8 内容并缓存', async () => {
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
  const client = new GitHubClient('', m.request);
  const result = await client.clone('git@github.com:demo/notes.git');
  assert.equal(result.files.length, 1); assert.equal(result.files[0].content, undefined);
  assert.equal(m.calls.filter(c => c.path.includes('/git/blobs/')).length, 0);
  const w = workspace(); attachRepository(w, result);
  const note = w.notes.find(n => n.title === '中文')!;
  const loader = new GitDocumentLoader(w, () => client);
  await loader.load(note.id); await loader.load(note.id);
  assert.equal(note.content, '中文内容\n'); assert.equal(note.remote, undefined);
  assert.equal(m.calls.filter(c => c.path.includes('/git/blobs/')).length, 1);
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
test('文件树被截断时仍拒绝不完整导入', async () => {
  const m = mock(call => {
    if (call.path === '/repos/demo/notes') return { default_branch: 'main' };
    if (call.path.includes('/git/ref/')) return { object: { sha: sha(1) } };
    if (call.path.includes('/git/commits/')) return { tree: { sha: sha(2) } };
    return { truncated: true, tree: [] };
  });
  await assert.rejects(new GitHubClient('', m.request).clone('https://github.com/demo/notes.git'), /完整文件树/);
  assert.equal(m.calls.filter(c => c.path.includes('/git/blobs/')).length, 0);
});
function importFixture(entries: { path: string; size: number }[], content = '内容') {
  return mock(call => {
    if (call.path === '/repos/demo/notes') return { default_branch: 'main' };
    if (call.path.includes('/git/ref/')) return { object: { sha: sha(1) } };
    if (call.path.includes('/git/commits/')) return { tree: { sha: sha(2) } };
    if (call.path.includes('/git/blobs/')) return { encoding: 'base64', content: Buffer.from(content).toString('base64') };
    return { truncated: false, tree: entries.map((entry, index) => ({ ...entry, type: 'blob', mode: '100644', sha: sha(index + 3) })) };
  });
}
test('可以导入超过 300 份文档，仍保留完整目录清单', async () => {
  const m = importFixture(Array.from({ length: 301 }, (_, index) => ({ path: `docs/${index}.md`, size: 6 })));
  const result = await new GitHubClient('', m.request).clone('https://github.com/demo/notes.git');
  assert.equal(result.files.length, 301);
  assert.equal(result.allPaths.length, 301);
  assert.equal(m.calls.length, 4);
  assert.equal(m.calls.filter(c => c.path.includes('/git/blobs/')).length, 0);
});
test('单份文档超过 2 MB 可完整解码并导入', async () => {
  const content = 'x'.repeat(2 * 1024 * 1024 + 1);
  const m = importFixture([{ path: 'large.md', size: content.length }], content);
  const result = await new GitHubClient('', m.request).clone('https://github.com/demo/notes.git');
  assert.equal(result.files[0].content, undefined);
  const text = await new GitHubClient('', m.request).readFile(result, result.files[0].sha);
  assert.equal(text.length, content.length);
  assert.ok(text === content);
});
test('目录中文档总计超过 8 MB 不再被应用拦截', async () => {
  // The old guard used GitHub's size metadata before requesting any file content.
  const m = importFixture(Array.from({ length: 5 }, (_, index) => ({ path: `${index}.md`, size: 1900000 })));
  const result = await new GitHubClient('', m.request).clone('https://github.com/demo/notes.git');
  assert.equal(result.files.length, 5);
  assert.equal(m.calls.filter(c => c.path.includes('/git/blobs/')).length, 0);
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
test('未打开的文件不产生修改；改名和删除可直接沿用原始 blob', async () => {
  const w = workspace(); const r = attachRepository(w, lazySnapshot());
  assert.deepEqual(gitChanges(w, r), []);
  const note = w.notes.find(n => n.title === '你好')!;
  assert.ok(note.remote); assert.equal(note.content, '');
  note.title = '改名';
  const changes = gitChanges(w, r);
  assert.deepEqual(changes.find(c => c.kind === 'added'), { path: 'docs/改名.MD', sha: sha(3), mode: '100755', kind: 'added' });
  assert.equal(changes.filter(c => c.kind === 'modified').length, 0);
  const m = mock(call => {
    if (call.method === 'GET') return { object: { sha: sha(1) } };
    if (call.path.endsWith('/git/trees')) return { sha: sha(10) };
    if (call.path.endsWith('/git/commits')) return { sha: sha(11) };
    return {};
  });
  await new GitHubClient('test-only', m.request).push(r, changes, '重命名文档');
  const entries = m.calls.find(c => c.path.endsWith('/git/trees'))!.body.tree;
  assert.equal(entries.find((e: any) => e.path === 'docs/改名.MD').sha, sha(3));
  assert.ok(entries.every((e: any) => !('content' in e)));
  assert.equal(m.calls.filter(c => c.path.includes('/git/blobs/')).length, 0);
  assert.ok(!entries.some((e: any) => e.path === 'README.md'));
});
test('缓存可跨刷新恢复，不下载、不误提交未打开文件', async () => {
  const w = workspace(); const r = attachRepository(w, lazySnapshot());
  const note = w.notes.find(n => n.title === '你好')!;
  const m = mock(() => ({ encoding: 'base64', content: Buffer.from('已缓存原文').toString('base64') }));
  await new GitDocumentLoader(w, () => new GitHubClient('', m.request)).load(note.id);
  assert.deepEqual(gitChanges(w, r), []);
  const restored = parseWorkspace(JSON.stringify(w))!;
  assert.ok(restored);
  const never = mock(() => { throw new Error('不应该发起网络请求'); });
  await new GitDocumentLoader(restored, () => new GitHubClient('', never.request)).load(note.id);
  assert.equal(never.calls.length, 0);
  assert.deepEqual(gitChanges(restored, restored.repositories![0]), []);
  assert.ok(restored.notes.find(n => n.title === 'README')?.remote);
  const target = workspace(); mergeWorkspace(target, restored);
  const unopened = target.notes.find(n => n.title === 'README')!;
  assert.equal(unopened.remote?.repositoryId, target.repositories![0].id);
  assert.ok(parseWorkspace(JSON.stringify(target)));
});
test('同时打开相同 blob 只请求一次，空文档也正确标记为已读取', async () => {
  const w = workspace(); const s = lazySnapshot(); s.files[1].sha = s.files[0].sha;
  const r = attachRepository(w, s);
  const notes = w.notes.filter(n => n.remote);
  const m = mock(() => ({ encoding: 'base64', content: '' }));
  const loader = new GitDocumentLoader(w, () => new GitHubClient('', m.request));
  await Promise.all([loader.load(notes[0].id), loader.load(notes[1].id), loader.load(notes[0].id)]);
  assert.equal(m.calls.length, 1);
  assert.ok(notes.every(n => n.remote === undefined && n.content === ''));
  assert.deepEqual(gitChanges(w, r), []);
});
test('读取失败不会把文件保存为空，可以重试', async () => {
  const w = workspace(); const r = attachRepository(w, lazySnapshot());
  const note = w.notes.find(n => n.title === '你好')!;
  const m = mock((call, calls) => calls.length === 1 ? Response.json({}, { status: 401 }) : { encoding: 'base64', content: Buffer.from('重试成功').toString('base64') });
  const loader = new GitDocumentLoader(w, () => new GitHubClient('', m.request));
  await assert.rejects(loader.load(note.id), /令牌/);
  assert.ok(note.remote); assert.deepEqual(gitChanges(w, r), []);
  await loader.load(note.id);
  assert.equal(note.content, '重试成功'); assert.equal(m.calls.length, 2);
});
test('拉取同一 SHA 复用缓存，新 SHA 必须重新读取', async () => {
  const w = workspace(); const r = attachRepository(w, lazySnapshot());
  const note = w.notes.find(n => n.title === '你好')!;
  const m = mock((call, calls) => ({ encoding: 'base64', content: Buffer.from(calls.length === 1 ? '旧内容' : '新内容').toString('base64') }));
  const loader = new GitDocumentLoader(w, () => new GitHubClient('', m.request));
  await loader.load(note.id);
  applySnapshot(w, r, lazySnapshot());
  assert.equal(note.content, '旧内容'); assert.equal(note.remote, undefined);
  const next = lazySnapshot(); next.files[0].sha = sha(77);
  applySnapshot(w, r, next);
  assert.ok(note.remote); assert.deepEqual(gitChanges(w, r), []);
  await loader.load(note.id);
  assert.equal(note.content, '新内容'); assert.equal(m.calls.length, 2);
});
test('旧读取请求晚于新版本返回，不覆盖新版本的文档', async () => {
  const w = workspace(); const r = attachRepository(w, lazySnapshot());
  const note = w.notes.find(n => n.title === '你好')!;
  let complete!: (response: Response) => void;
  const request = (() => new Promise<Response>(resolve => { complete = resolve; })) as typeof fetch;
  const loader = new GitDocumentLoader(w, () => new GitHubClient('', request));
  const reading = loader.load(note.id);
  const next = lazySnapshot(); next.files[0].sha = sha(77);
  applySnapshot(w, r, next);
  complete(Response.json({ encoding: 'base64', content: Buffer.from('过期内容').toString('base64') }));
  await assert.rejects(reading, /版本已更新/);
  assert.equal(note.content, ''); assert.equal(note.remote?.sha, sha(77));
  assert.deepEqual(gitChanges(w, r), []);
});
test('未打开文档移到仓库外或从源基线删除后，仍可按原 SHA 读取', async () => {
  const w = workspace(); const r = attachRepository(w, lazySnapshot());
  const note = w.notes.find(n => n.title === '你好')!;
  note.folderId = null;
  assert.deepEqual(gitChanges(w, r), [{ path: 'docs/你好.MD', kind: 'deleted', mode: '100755' }]);
  r.files = r.files.filter(f => f.path !== 'docs/你好.MD');
  const m = mock(() => ({ encoding: 'base64', content: Buffer.from('原始内容').toString('base64') }));
  await new GitDocumentLoader(w, () => new GitHubClient('', m.request)).load(note.id);
  assert.equal(note.content, '原始内容');
  assert.equal(note.remote, undefined);
});
test('无效的未加载标记不能作为空白已加载文档恢复', () => {
  for (const remote of [false, null, { repositoryId: 'missing', path: 'a.md', sha: sha(3) }]) {
    const w = workspace(); w.notes[0].remote = remote as any;
    assert.equal(parseWorkspace(JSON.stringify(w)), null);
  }
});

import { api } from './api';
import { imageReference } from './images';
import type { Workspace } from './documents';
import { applySnapshot, attachRepository, GitHubClient, GitDocumentLoader, gitChanges, parseCloneUrl, repositoryFiles, repositoryPath } from './github';
import type { GitChange, GitRepository } from './git-types';

const esc = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const labels = { added: '新增', modified: '修改', deleted: '删除' };

export function createGitPanel(workspace: Workspace, hooks: {
  changed: (noteId?: string, folderId?: string, refreshEditors?: boolean) => void;
  notify: (message: string) => void;
}) {
  const dialog = document.createElement('dialog'); dialog.className = 'git-dialog';
  document.body.append(dialog);
  const tokens = new Map<string, string>();
  const tokenKey = (r: { owner: string; repo: string }) => `${r.owner.toLowerCase()}/${r.repo.toLowerCase()}`;
  const loader = new GitDocumentLoader(workspace, repository => new GitHubClient(tokens.get(tokenKey(repository)) ?? ''));
  let selectedId = '';
  let busy = false;
  let reviewed: GitChange[] | null = null;
  const repo = () => workspace.repositories?.find(r => r.id === selectedId);
  const field = (id: string) => dialog.querySelector<HTMLInputElement>(`#${id}`)!;
  const status = (message: string, error = false) => {
    const el = dialog.querySelector<HTMLElement>('#git-status')!;
    el.textContent = message; el.classList.toggle('git-error', error);
  };
  function tokenFor(repository: { owner: string; repo: string }) {
    const key = tokenKey(repository);
    const token = field('git-token').value.trim() || tokens.get(key) || '';
    if (token) tokens.set(key, token);
    return token;
  }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    busy = true;
    dialog.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input, button, select').forEach(el => el.disabled = true);
    try { await action(); }
    catch (error) { status(error instanceof Error ? error.message : '操作失败，请稍后重试。', true); }
    finally {
      busy = false;
      dialog.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input, button, select').forEach(el => el.disabled = false);
      const push = dialog.querySelector<HTMLButtonElement>('#git-push');
      if (push) push.disabled = !reviewed?.length;
    }
  }
  function renderPreview(repository: GitRepository, changes: GitChange[]) {
    const list = dialog.querySelector<HTMLElement>('#git-changes')!;
    list.innerHTML = changes.length ? changes.map((change, index) => `<details class="git-change" data-change="${index}"><summary><span class="git-change-kind ${change.kind}">${labels[change.kind]}</span><span>${esc(change.path)}</span></summary><div class="git-change-content"></div></details>`).join('') : '<p class="git-help">没有需要提交的文档更改。</p>';
    list.querySelectorAll<HTMLDetailsElement>('details').forEach(details => {
      details.ontoggle = () => {
        const container = details.querySelector<HTMLElement>('.git-change-content')!;
        if (!details.open || container.childNodes.length) return;
        const change = changes[Number(details.dataset.change)];
        const before = repository.files.find(file => file.path === change.path)?.content;
        for (const [label, content] of [['仓库原文', before], ['本次提交', change.content]] as const) {
          if (content === undefined) continue;
          const heading = document.createElement('p'); heading.textContent = label;
          const pre = document.createElement('pre'); pre.textContent = content.slice(0, 12000) + (content.length > 12000 ? '\n…预览已截断' : '');
          container.append(heading, pre);
        }
        if (change.base64 !== undefined) { const p = document.createElement('p'); p.textContent = `图片文件，约 ${Math.ceil(change.base64.length * 0.75 / 1024)} KiB，将使用二进制 blob 提交。`; container.append(p); }
        if (!container.childNodes.length) container.textContent = change.kind === 'deleted' ? '仅删除此路径，未下载未打开文档的原文。' : '文档内容未修改，提交沿用仓库已有文件内容。';
      };
    });
    dialog.querySelector<HTMLButtonElement>('#git-push')!.disabled = !changes.length;
  }
  function render() {
    reviewed = null;
    const repository = repo();
    dialog.innerHTML = `<form method="dialog"><div class="git-heading"><h2>GitHub 仓库</h2><button value="cancel" aria-label="关闭 GitHub 面板" class="git-close">×</button></div>
      <label class="git-label">当前仓库<select id="git-selected"><option value="">导入新仓库…</option>${(workspace.repositories ?? []).map(r => `<option value="${esc(r.id)}" ${r.id === selectedId ? 'selected' : ''}>${esc(`${r.owner}/${r.repo} · ${r.branch}`)}</option>`).join('')}</select></label>
      ${repository ? `<div class="git-repository-info"><strong>${esc(repository.owner)}/${esc(repository.repo)}</strong><span>分支 ${esc(repository.branch)}</span></div>` : `<label class="git-label">Clone 地址<input id="git-url" placeholder="https://github.com/用户名/文档仓库.git" autocomplete="off" /></label><label class="git-label">分支（留空使用默认分支）<input id="git-branch" placeholder="例如 main" autocomplete="off" /></label>`}
      <label class="git-label">GitHub 访问令牌 <span>公开仓库导入可留空；私有仓库和 push 需要填写</span><input id="git-token" type="password" placeholder="留空使用当前账号已加密保存的令牌" autocomplete="off" spellcheck="false" /></label>
      <p class="git-help">令牌通过 ${location.protocol === 'https:' ? 'HTTPS' : 'HTTP'} 发送至后端，以 AES-256-GCM 加密保存，仅供当前账号访问 GitHub，不包含在文档备份中。填写后执行导入、拉取或 push 即保存；留空沿用已保存令牌。请授予目标仓库 Contents 读写权限。</p>
      ${repository ? `<div class="git-actions"><button type="button" id="git-pull">拉取最新</button><button type="button" id="git-review">检查更改</button><button type="button" id="git-forget">删除已存令牌</button></div><div id="git-changes" aria-label="待提交更改"></div><label class="git-label">提交说明<input id="git-message" value="更新 Markdown 文档" maxlength="500" /></label><p class="git-help">仅提交该仓库文件夹内的文档。重命名或移动文件会改变仓库路径，删除也会同步；其他类型文件保持不变。</p><button type="button" id="git-push" class="primary" disabled>提交并 push</button>` : '<button type="button" id="git-clone" class="primary">导入仓库</button>'}
      <p id="git-status" role="status" aria-live="polite"></p></form>`;
    dialog.querySelector<HTMLSelectElement>('#git-selected')!.onchange = event => { selectedId = (event.target as HTMLSelectElement).value; render(); };
    if (!repository) {
      dialog.querySelector<HTMLButtonElement>('#git-clone')!.onclick = () => run(async () => {
        const parsed = parseCloneUrl(field('git-url').value);
        status('正在读取仓库目录…');
        const snapshot = await new GitHubClient(tokenFor(parsed)).clone(field('git-url').value, field('git-branch').value);
        if (workspace.repositories?.some(r => r.owner.toLowerCase() === snapshot.owner.toLowerCase() && r.repo.toLowerCase() === snapshot.repo.toLowerCase() && r.branch === snapshot.branch)) throw new Error('该仓库分支已经导入，请切换到已有连接进行拉取。');
        const connected = attachRepository(workspace, snapshot);
        selectedId = connected.id;
        hooks.changed(undefined, connected.rootFolderId);
        render(); dialog.close();
        hooks.notify(`已载入 ${snapshot.files.length} 份文档的目录，点击文件时读取内容。`);
      });
    } else {
      dialog.querySelector<HTMLButtonElement>('#git-forget')!.onclick = () => run(async () => { await api('/git/credential', 'DELETE', { repository: `${repository.owner}/${repository.repo}` }); tokens.delete(tokenKey(repository)); field('git-token').value = ''; status('当前账号为此仓库保存的令牌已删除。'); });
      dialog.querySelector<HTMLButtonElement>('#git-review')!.onclick = () => {
        try { reviewed = gitChanges(workspace, repository); renderPreview(repository, reviewed); status(reviewed.length ? `共 ${reviewed.length} 项更改。可展开查看内容，确认后提交。` : '文档与导入时的版本一致。'); }
        catch (error) { reviewed = null; status((error as Error).message, true); }
      };
      dialog.querySelector<HTMLButtonElement>('#git-pull')!.onclick = () => run(async () => {
        if (gitChanges(workspace, repository).length) throw new Error('存在未提交的本地改动，已停止拉取。请先提交，或导出备份后手动合并。');
        status('正在拉取最新版本…');
        const snapshot = await new GitHubClient(tokenFor(repository)).clone(`https://github.com/${repository.owner}/${repository.repo}.git`, repository.branch);
        if (gitChanges(workspace, repository).length) throw new Error('拉取期间文档发生了变化，本地内容未被覆盖。');
        applySnapshot(workspace, repository, snapshot);
        hooks.changed(undefined, repository.rootFolderId, true);
        render(); status('已更新目录；已打开且未变更的文档继续使用缓存。');
      });
      dialog.querySelector<HTMLButtonElement>('#git-push')!.onclick = () => run(async () => {
        const changes = gitChanges(workspace, repository);
        if (JSON.stringify(changes) !== JSON.stringify(reviewed)) throw new Error('更改清单发生了变化，请重新检查更改。');
        const outgoing = repositoryFiles(workspace, repository);
        status('正在检查远端版本并提交文档…');
        const result = await new GitHubClient(tokenFor(repository)).push(repository, changes, field('git-message').value);
        const oldPaths = new Set([...repository.files, ...(repository.imageFiles ?? [])].map(f => f.path));
        repository.files = outgoing.filter(f => /\.(md|markdown|txt)$/i.test(f.path)).map(f => ({ ...f, sha: f.sha ?? '' }));
        repository.imageFiles = outgoing.filter(f => !/\.(md|markdown|txt)$/i.test(f.path)).map(({ base64: _base64, ...f }) => ({ ...f, sha: result.blobs?.[f.path] ?? f.sha ?? '' }));
        for (const asset of workspace.images ?? []) {
          const note = workspace.notes.find(n => n.id === asset.noteId); if (!note) continue;
          const path = repositoryPath(workspace, repository, note); if (path === null) continue;
          const imagePath = (path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '') + imageReference(asset);
          const baseline = repository.imageFiles.find(f => f.path === imagePath);
          if (baseline?.sha) asset.remote = { repositoryId: repository.id, path: imagePath, sha: baseline.sha };
        }
        repository.allPaths = [...repository.allPaths.filter(path => !oldPaths.has(path)), ...outgoing.map(f => f.path)];
        repository.headSha = result.headSha; repository.treeSha = result.treeSha;
        for (const note of workspace.notes) {
          if (note.remote?.repositoryId !== repository.id) continue;
          const path = repositoryPath(workspace, repository, note);
          if (path !== null) note.remote.path = path;
        }
        hooks.changed();
        render(); status(`已 push 到 ${repository.branch}，提交 ${result.headSha.slice(0, 7)}。`);
        hooks.notify('文档已提交并 push 到 GitHub。');
      });
    }
  }
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    const password = dialog.querySelector<HTMLInputElement>('#git-token');
    const selected = repo();
    if (password?.value.trim() && selected) tokens.set(tokenKey(selected), password.value.trim());
    if (password) password.value = '';
  });
  return {
    loadNote(noteId: string) { return loader.load(noteId); },
    open(folderId: string | null, noteId: string) {
      const note = workspace.notes.find(n => n.id === noteId);
      const findRepository = (id: string | null | undefined): GitRepository | undefined => {
        const seen = new Set<string>();
        while (id && !seen.has(id)) {
          seen.add(id);
          const connected = workspace.repositories?.find(r => r.rootFolderId === id);
          if (connected) return connected;
          id = workspace.folders.find(f => f.id === id)?.parentId;
        }
      };
      const selected = findRepository(folderId) ?? findRepository(note?.folderId);
      selectedId = selected?.id ?? workspace.repositories?.[0]?.id ?? '';
      render(); dialog.showModal();
    },
  };
}

import Editor from '@toast-ui/editor';
import '@toast-ui/editor/dist/toastui-editor.css';
import '@toast-ui/editor/dist/theme/toastui-editor-dark.css';
import '@toast-ui/editor/dist/i18n/zh-cn';
import DOMPurify from 'dompurify';
import { createIcons, GitBranch, FilePlus, Search, FolderOpen, Folder, FolderPlus, ChevronRight, Upload, HardDrive, Moon, PanelLeft, Maximize, Download, ChevronDown, FileText, Trash2, PenLine, CodeXml, ListTree, Sparkles, Keyboard, CheckCheck, CircleAlert, Sun } from 'lucide';
import { canMoveFolder, ensureFolderPath, mergeWorkspace, filename, headings, parseWorkspace, readingStats, type Workspace } from './documents';
import { welcome } from './welcome';
import { markdownShortcuts } from './markdown-shortcuts';
import { clickToWrite } from './click-to-write';
import { createFileMenu } from './file-menu';
import { createGitPanel } from './git-ui';
import { WorkspaceSaver } from './autosave';
import { accountPanel } from './account';
import { sessionRedirecting, type Session } from './api';
import { createImageAsset, encodeImage, imageMime, imageReference, imageURL, markdownImagePath, renameNoteImages } from './images';
import { documentImages } from './image-editor';
import { documentArchive } from './image-export';
import { createEditorToolbar } from './editor-toolbar';
import { codeBlocks, previewCodeCopy } from './code-blocks';
import { flowSVG } from './flow-diagrams';
import { isFlowLanguage } from './flow-source';
import './style.css';
import './ui-polish.css';

const icons = { GitBranch, FilePlus, Search, FolderOpen, Folder, FolderPlus, ChevronRight, Upload, HardDrive, Moon, PanelLeft, Maximize, Download, ChevronDown, FileText, Trash2, PenLine, CodeXml, ListTree, Sparkles, Keyboard, CheckCheck, CircleAlert, Sun };
const icon = (name: string, cls = '') => `<i data-lucide="${name}" class="${cls}"></i>`;
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function mountEditor(restored: Workspace | null, revision: number, session: Session) {
let workspace: Workspace = restored ?? initialWorkspace();
function initialWorkspace(): Workspace { return { folders: [], activeId: 'welcome', notes: [{ id: 'welcome', title: '欢迎来到你的写作空间', content: welcome, updatedAt: Date.now() }] }; }
const active = () => workspace.notes.find(n => n.id === workspace.activeId)!;
const fontOptions = [
  { id: 'songti', label: '宋体', family: '"SimSun", "宋体", "Songti SC", "STSong", serif' },
  { id: 'heiti', label: '黑体', family: '"SimHei", "黑体", "Heiti SC", "PingFang SC", "Microsoft YaHei", sans-serif' },
  { id: 'kaiti', label: '楷体', family: '"KaiTi", "楷体", "Kaiti SC", "STKaiti", serif' },
  { id: 'fangsong', label: '仿宋', family: '"FangSong", "仿宋", "STFangsong", "Songti SC", serif' },
  { id: 'system', label: '系统默认', family: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif' },
];
let documentFont = fontOptions.find(font => font.id === workspace.settings?.font) ?? fontOptions[0];

document.documentElement.style.setProperty('--document-font', documentFont.family);
let selectedFolderId: string | null = active().folderId ?? null;
let sourceMode = false;
let focusMode = false;
let theme = workspace.settings?.theme === 'dark' ? 'dark' : 'light';

document.documentElement.dataset.theme = theme;

$('#app').innerHTML = `
  <aside class="sidebar" aria-label="文档导航">
    <a class="brand" href="./" aria-label="MkDocs Web 首页"><span class="brand-mark">m<span>k</span></span><span>MkDocs <b>Web</b></span></a>
    <label class="search">${icon('search')}<input id="search" placeholder="搜索你的文档…" aria-label="搜索文档" title="搜索文件名和已缓存正文"/><kbd>⌘ K</kbd></label>
    <div class="section-label tree-root" data-drop-root><span>文件</span><div class="tree-actions"><button id="new-note" class="icon-button" aria-label="新建文件" title="新建文件（⌘ / Ctrl + Shift + N）">${icon('file-plus')}</button><button id="new-folder" class="icon-button" aria-label="新建文件夹" title="新建文件夹">${icon('folder-plus')}</button><button id="import-folder" class="icon-button" aria-label="导入文件夹" title="导入文件夹">${icon('folder-open')}</button></div></div>
    <nav id="note-list" role="tree" aria-label="文档文件夹"></nav>
    <div class="sidebar-bottom"><button id="git-repository" class="import-button">${icon('git-branch')} GitHub 仓库</button><button id="import" class="import-button">${icon('folder-open')} 导入 Markdown ${icon('upload')}</button><div class="sidebar-meta"><button id="account" class="text-button">账号管理</button><button id="theme" class="icon-button" aria-label="切换深色主题" title="切换深色主题">${icon('moon')}</button></div></div>
  </aside>
  <main class="main">
    <header class="topbar"><div class="breadcrumb"><button id="sidebar-toggle" class="icon-button" aria-label="显示或隐藏文档列表">${icon('panel-left')}</button><span class="crumb-parent">我的文档</span><span class="slash">/</span><span id="crumb-title"></span></div><div class="editor-bar"><div class="editor-toolbar-mount"></div><span class="editor-bar-label">${icon('pen-line')} 开始书写</span><div class="writing-options"><button id="insert-image" class="text-button" title="图片保存在当前文档同名 .assets 目录">插入图片</button><label class="font-picker"><span>字体</span><select id="font-select" aria-label="文档字体" title="使用设备已安装的字体">${fontOptions.map(font => `<option value="${font.id}" ${font.id === documentFont.id ? 'selected' : ''}>${font.label}</option>`).join('')}</select>${icon('chevron-down')}</label><button id="source-toggle" class="mode-toggle" aria-pressed="false">${icon('code-xml')}<span>源码模式</span></button></div></div><div class="top-actions"><span id="save-state" role="status"></span><button id="focus" class="text-button">${icon('maximize')}<span>专注</span></button><div class="export-wrap"><button id="export" class="export-button" aria-expanded="false">${icon('download')} 导出 ${icon('chevron-down')}</button><div id="export-menu" class="dropdown" hidden><button data-export="md">Markdown (.md)</button><button data-export="bundle">文档与图片 (.zip)</button><button data-export="html">网页 (.html)</button><button data-export="print">打印 / 存为 PDF</button><button data-export="backup">备份所有文档 (.json)</button><button data-export="restore">恢复文档备份</button></div></div></div></header>
    <div class="work-area"><section class="writing-pane" aria-label="写作区"><div class="document-heading"><div class="eyebrow">你的文字，值得被认真对待</div><div class="title-row"><input id="doc-title" aria-label="文档标题" maxlength="100"/><button id="delete-note" class="icon-button" title="删除文档" aria-label="删除当前文档">${icon('trash-2')}</button></div><div class="document-meta">${icon('file-text')}<span>Markdown 文档</span><span class="meta-dot">·</span><span id="updated-at"></span></div></div><div id="editor"><div id="document-load-state" class="document-load-state" hidden><p id="document-load-message" role="status"></p><button id="retry-note" hidden>重试读取</button></div></div></section><aside class="outline" aria-label="文档大纲"><div class="outline-heading">${icon('list-tree')} 文档大纲</div><nav id="outline-list"></nav><div class="outline-tip">${icon('sparkles')}<p>让文字回归文字。<br/>让思绪自由流淌。</p><span>WRITE SOMETHING GOOD.</span></div></aside></div>
    <footer class="statusbar"><div><span class="status-dot"></span><span id="footer-state">所有更改已保存至服务器</span></div><div><span id="word-count"></span><span class="status-divider">|</span><span id="read-time"></span><span class="status-divider">|</span><span>UTF-8</span><span class="status-divider">|</span><button id="shortcuts">${icon('keyboard')} 快捷键</button></div></footer>
  </main><input id="image-input" type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden/><input id="file-input" type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" multiple hidden/><input id="directory-input" type="file" webkitdirectory multiple hidden/><input id="backup-input" type="file" accept=".json,application/json" hidden/><div id="toast" role="status" hidden></div><dialog id="dialog"><form method="dialog"><div id="dialog-content"></div><div class="dialog-actions"><button value="cancel">取消</button><button value="confirm" class="primary">确定</button></div></form></dialog>`;

const toolbarSettings = $('.writing-options');
const toolbarMount = $('.editor-toolbar-mount');
const imageUploads = new Set<Promise<void>>();
const editors = new Map<string, { instance: Editor; host: HTMLDivElement; toolbar: ReturnType<typeof createEditorToolbar> }>();
function makeEditor(content: string) {
  const noteId = workspace.activeId;
  const host = document.createElement('div'); host.className = 'editor-instance'; host.hidden = true; $('#editor').append(host);
  const instance = new Editor({ el: host, height: '100%', initialEditType: sourceMode ? 'markdown' : 'wysiwyg', previewStyle: 'vertical', initialValue: content, language: 'zh-CN', usageStatistics: false, hideModeSwitch: true, theme, autofocus: false, plugins: [markdownShortcuts, clickToWrite, codeBlocks, documentImages(session.user.id, noteId, workspace)], placeholder: '直接输入 Markdown：## 完整标题后回车渲染标题，```javascript 后回车创建代码块…', toolbarItems: [['heading', 'bold', 'italic', 'strike'], ['hr', 'quote'], ['ul', 'ol', 'task'], ['table', 'link', 'image'], ['code', 'codeblock']], hooks: { addImageBlobHook: (blob, callback) => { uploadImage(noteId, blob, callback); } } });
  const stopCodeCopy = previewCodeCopy(host);
  const destroyEditor = instance.destroy.bind(instance);
  instance.destroy = () => { stopCodeCopy(); destroyEditor(); };
  editors.set(workspace.activeId, { instance, host, toolbar: createEditorToolbar(host) });
  return instance;
}
let editor = makeEditor(active().content);
function activateToolbar() {
  const toolbar = editors.get(workspace.activeId)!.toolbar;
  toolbar.row.append(toolbarSettings); toolbarMount.replaceChildren(toolbar.viewport);
  toolbarMount.classList.toggle('toastui-editor-dark', theme === 'dark');
  toolbar.refresh();
}
activateToolbar();
let loading = false;
let selectionVersion = 0;
let saveTimer: ReturnType<typeof setTimeout>;
let toastTimer: ReturnType<typeof setTimeout>;
editor.on('change', onChange);
function refreshIcons() { createIcons({ icons, attrs: { 'stroke-width': 1.65 } }); }
function notify(message: string) { if (!document.querySelector('#toast')) return; clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => $('#toast').hidden = true, 3500); }
function setSaveState(saved: boolean) {
  if (!document.querySelector('#save-state')) return;
  $('#save-state').innerHTML = `${icon(saved ? 'check-check' : 'circle-alert')}<span>${saved ? '已保存' : '未保存'}</span>`;
  $('#footer-state').textContent = saved ? '所有更改已保存至服务器' : '尚未保存至服务器，请检查连接或导出备份';
  refreshIcons();
}
const saver = new WorkspaceSaver(revision, restored, (saved, error) => { setSaveState(saved); if (error) notify(error); });
function persist() {
  clearTimeout(saveTimer);
  saver.enqueue(workspace);
  void saver.flush().catch(() => {});
}
$('#account').onclick = () => accountPanel(session, async () => { await Promise.all(imageUploads); clearTimeout(saveTimer); saver.enqueue(workspace); await saver.flush(); });
function uploadImage(noteId: string, blob: Blob, insert: (url: string, text?: string) => void) {
  const promise = (async () => {
    const note = workspace.notes.find(n => n.id === noteId);
    if (!note || note.remote) throw new Error('请等待文档读取完成。');
    const asset = await createImageAsset(note, blob);
    if (!workspace.notes.some(n => n.id === noteId)) throw new Error('文档已删除，未插入图片。');
    (workspace.images ??= []).push(asset);
    // Commit the bytes before the editor requests the authenticated image URL.
    saver.enqueue(workspace); await saver.flush();
    if (!workspace.notes.some(n => n.id === noteId)) return;
    insert(markdownImagePath(imageReference(asset)), blob instanceof File ? blob.name : '图片');
    const ownEditor = editors.get(noteId)?.instance;
    if (ownEditor) { note.content = ownEditor.getMarkdown(); note.updatedAt = Date.now(); }
    persist(); notify(`图片已保存至 ${asset.folder}/`);
  })().catch(error => notify((error as Error).message)).finally(() => imageUploads.delete(promise));
  imageUploads.add(promise);
}
$('#insert-image').onclick = () => { if (active().remote) { notify('请等待读取完成。'); return; } $<HTMLInputElement>('#image-input').click(); };
$<HTMLInputElement>('#image-input').onchange = event => {
  const input = event.target as HTMLInputElement; const noteId = workspace.activeId; const ownEditor = editor;
  for (const file of Array.from(input.files ?? [])) uploadImage(noteId, file, (imageUrl, altText) => ownEditor.exec('addImage', { imageUrl, altText }));
  input.value = '';
};
async function readImage(relative: string, noteId = workspace.activeId) {
  const response = await fetch(imageURL(session.user.id, noteId, relative), { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok || !response.headers.get('Content-Type')?.startsWith('image/')) throw new Error('图片读取失败，请检查网络或 GitHub 令牌后重试。');
  return new Uint8Array(await response.arrayBuffer());
}
function onChange() {
  if (loading || !editor || active().remote) return;
  active().content = editor.getMarkdown(); active().updatedAt = Date.now();
  renderStats(); renderOutline();
  $('#save-state').textContent = '保存中…';
  $('#footer-state').textContent = '正在保存更改…';
  clearTimeout(saveTimer); saveTimer = setTimeout(() => { persist(); renderNotes(); }, 350);
}
function renderStats() {
  if (active().remote) { $('#word-count').textContent = '内容待读取'; $('#read-time').textContent = '按需加载'; $('#updated-at').textContent = 'GitHub 文档'; return; }
  const stats = readingStats(active().content);
  $('#word-count').textContent = `${stats.characters.toLocaleString()} 字符`;
  $('#read-time').textContent = `约 ${stats.minutes} 分钟阅读`;
  $('#updated-at').textContent = `编辑于 ${new Date(active().updatedAt).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}`;
}
function renderNotes() {
  const term = $<HTMLInputElement>('#search').value.trim().toLocaleLowerCase();
  const visibleFolders = new Set<string>();
  const notes = workspace.notes.filter(n => `${n.title}\n${n.content}`.toLocaleLowerCase().includes(term));
  if (term) {
    const reveal = (id: string | null | undefined) => {
      while (id) { visibleFolders.add(id); id = workspace.folders.find(f => f.id === id)?.parentId; }
    };
    notes.forEach(n => reveal(n.folderId));
    workspace.folders.filter(f => f.name.toLocaleLowerCase().includes(term)).forEach(f => reveal(f.id));
  }
  const renderBranch = (parentId: string | null, depth: number): string => {
    const folders = workspace.folders.filter(f => f.parentId === parentId && (!term || visibleFolders.has(f.id)));
    const files = notes.filter(n => (n.folderId ?? null) === parentId);
    return folders.map(f => {
      const expanded = !!term || !f.collapsed;
      return `<div role="none"><button role="treeitem" aria-expanded="${expanded}" aria-level="${depth + 1}" class="folder-row ${selectedFolderId === f.id ? 'selected-folder' : ''}" data-folder="${escape(f.id)}" draggable="true" title="${escape(f.name)}（双击重命名）" style="--depth:${depth}">${icon(expanded ? 'chevron-down' : 'chevron-right', 'tree-chevron')}${icon(expanded ? 'folder-open' : 'folder')}<span class="tree-title">${escape(f.name)}</span></button>${expanded ? `<div role="group">${renderBranch(f.id, depth + 1)}</div>` : ''}</div>`;
    }).join('') + files.map(n => `<div class="note-file-row ${n.id === workspace.activeId ? 'active' : ''}" role="none" style="--depth:${depth}"><button role="treeitem" aria-level="${depth + 1}" aria-selected="${n.id === workspace.activeId}" class="note-item ${n.id === workspace.activeId ? 'active' : ''}" data-id="${escape(n.id)}" draggable="true" title="${escape(n.title || '未命名文档')}">${icon('file-text')}<span class="tree-title">${escape(n.title || '未命名文档')}</span></button><button type="button" class="note-file-trigger" data-note-menu="${escape(n.id)}" aria-label="${escape(n.title || '未命名文档')}的文件操作" aria-haspopup="menu" aria-expanded="false" draggable="false" title="文件操作">${icon('chevron-down')}</button></div>`).join('');
  };
  fileMenu.close();
  $('#note-list').innerHTML = renderBranch(null, 0) || '<p class="empty-search">没有找到文档</p>';
  refreshIcons();
}
function revealFolder(id: string | null) {
  while (id) { const folder = workspace.folders.find(f => f.id === id); if (!folder) break; folder.collapsed = false; id = folder.parentId; }
}

function renderOutline() {
  if (active().remote) { $('#outline-list').innerHTML = '<p class="empty-search">读取文档后显示大纲</p>'; return; }
  const list = headings(active().content);
  $('#outline-list').innerHTML = list.map((h, index) => `<button data-heading="${index}" style="--level:${Math.min(h.level, 4)}" class="${index === 0 ? 'current' : ''}">${escape(h.text)}</button>`).join('') || '<p class="empty-search">添加标题后，大纲将显示在这里</p>';
}
function setDocumentLoading(message: string | null, failed = false) {
  $('#editor').classList.toggle('document-loading', message !== null);
  $('#document-load-state').hidden = message === null;
  $('#document-load-message').textContent = message ?? '';
  $('#retry-note').hidden = !failed;
  $<HTMLButtonElement>('#source-toggle').disabled = message !== null;
  $('.writing-pane').setAttribute('aria-busy', String(message !== null && !failed));
}
async function selectNote(id: string, expandFolders = true) {
  if (!workspace.notes.some(n => n.id === id)) return;
  const version = ++selectionVersion;
  if (workspace.notes.some(n => n.id === workspace.activeId)) persist(); workspace.activeId = id;
  selectedFolderId = active().folderId ?? null;
  if (expandFolders) revealFolder(selectedFolderId);
  $('#export-menu').hidden = true;
  $<HTMLInputElement>('#doc-title').value = active().title;
  $('#crumb-title').textContent = active().title || '未命名文档';
  document.title = `${active().title || '未命名文档'} · MkDocs Web`;
  renderNotes(); renderStats(); renderOutline(); persist();
  const needsContent = !!active().remote;
  if (needsContent) {
    setDocumentLoading('正在从 GitHub 读取这份文档…');
    try { await gitPanel.loadNote(id); persist(); }
    catch (error) {
      if (version === selectionVersion) setDocumentLoading(`${error instanceof Error ? error.message : '读取失败。'} 私有仓库可在 GitHub 仓库面板填写令牌后重试。`, true);
      return;
    }
    if (version !== selectionVersion || workspace.activeId !== id) return;
  }
  loading = true;
  // Each opened note retains its own editor and undo history. Unopened notes have no editor.
  const existing = editors.get(id);
  if (existing) { editor = existing.instance; if (needsContent) editor.setMarkdown(active().content, false); }
  else { editor = makeEditor(active().content); editor.on('change', onChange); }
  for (const [noteId, entry] of editors) {
    entry.host.hidden = noteId !== id;
    entry.host.classList.toggle('active-editor', noteId === id);
  }
  activateToolbar();
  setDocumentLoading(null);
  window.dispatchEvent(new Event('resize'));
  editor.changeMode(sourceMode ? 'markdown' : 'wysiwyg', true); editor.moveCursorToStart(false); loading = false;
  renderNotes(); renderStats(); renderOutline(); persist();
}
$('#retry-note').onclick = () => selectNote(workspace.activeId);

function createNote(content = '', title = '未命名文档', folderId = selectedFolderId) {
  const note = { id: crypto.randomUUID(), title, content, folderId, updatedAt: Date.now() };
  workspace.notes.unshift(note); selectNote(note.id); $<HTMLInputElement>('#doc-title').focus(); $<HTMLInputElement>('#doc-title').select();
}
function download(content: string | Uint8Array<ArrayBuffer>, name: string, type: string) { const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
async function exportNote(format: string) {
  if (format === 'restore') { $<HTMLInputElement>('#backup-input').click(); return; }
  if (format === 'backup') { download(JSON.stringify(workspace, null, 2), 'mkdocsweb-backup.json', 'application/json'); return; }
  if (active().remote) { notify('请等待文档读取完成后再导出。'); return; }
  if (format === 'bundle') {
    const note = active();
    try { const archive = await documentArchive(workspace, note, path => readImage(path, note.id)); download(new Uint8Array(archive), `${filename(note.title)}.zip`, 'application/zip'); notify('已打包 Markdown 与同级图片目录。'); } catch (error) { notify((error as Error).message); }
    return;
  }
  if (format === 'print') { if (sourceMode) $('#source-toggle').click(); window.print(); return; }
  if (format === 'md') download(active().content, `${filename(active().title)}.md`, 'text/markdown;charset=utf-8');
  else { const fragment = document.createElement('div'); fragment.innerHTML = DOMPurify.sanitize(editor.getHTML());
    fragment.querySelectorAll('.code-copy, .flow-source-toggle, .flow-canvas').forEach(control => control.remove());
    try {
      for (const code of fragment.querySelectorAll('pre > code[data-language]')) {
        if (isFlowLanguage(code.getAttribute('data-language') ?? '')) { const diagram = document.createElement('div'); diagram.style.overflowX = 'auto'; diagram.innerHTML = await flowSVG(code.textContent ?? ''); code.parentElement!.replaceWith(diagram); }
      }
      for (const image of fragment.querySelectorAll('img')) {
        const src = image.getAttribute('src') ?? '';
        if (src.startsWith('/api/images/')) { const response = await fetch(src, { credentials: 'same-origin', cache: 'no-store' }); if (!response.ok) throw new Error('图片读取失败，未导出不完整网页。'); const bytes = new Uint8Array(await response.arrayBuffer()); const mime = imageMime(bytes); if (!mime) throw new Error('图片格式无效。'); image.src = `data:${mime};base64,${encodeImage(bytes)}`; }
      }
    } catch (error) { notify((error as Error).message); return; }
    const html = fragment.innerHTML; download(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(active().title)}</title><style>body{max-width:800px;margin:60px auto;padding:0 24px;font:17px/1.85 ${documentFont.family};color:#29342e}pre{overflow:auto;padding:20px;background:#f4f6f5}code{font-family:monospace}blockquote{border-left:3px solid #6a927b;margin-left:0;padding-left:20px;color:#66756c}table{border-collapse:collapse;width:100%}td,th{padding:10px;border:1px solid #ddd}img{max-width:100%}</style><body>${html}</body></html>`, `${filename(active().title)}.html`, 'text/html;charset=utf-8'); }
  notify('已导出，文字随你带走。');
}
$<HTMLSelectElement>('#font-select').onchange = event => {
  documentFont = fontOptions.find(font => font.id === (event.target as HTMLSelectElement).value) ?? fontOptions[0];
  document.documentElement.style.setProperty('--document-font', documentFont.family);
  workspace.settings = { ...workspace.settings, font: documentFont.id }; persist();
};
const gitPanel = createGitPanel(workspace, {
  notify,
  changed(noteId, folderId, refreshEditors) {
    if (refreshEditors) {
      loading = true;
      for (const [id, entry] of editors) {
        const note = workspace.notes.find(n => n.id === id);
        if (note && !note.remote) entry.instance.setMarkdown(note.content, false);
      }
      loading = false;
    }
    if (!workspace.notes.length) createNote('', '未命名文档', null);
    const nextId = noteId ?? (workspace.notes.some(n => n.id === workspace.activeId) ? workspace.activeId : workspace.notes[0].id);
    if (refreshEditors || nextId !== workspace.activeId) selectNote(nextId);
    if (folderId !== undefined) { selectedFolderId = folderId; revealFolder(folderId); }
    renderNotes(); persist();
  },
});
$('#git-repository').onclick = () => gitPanel.open(selectedFolderId, workspace.activeId);
const fileMenu = createFileMenu($('#note-list'), id => { void deleteNote(id); });
$('#new-note').onclick = () => createNote();
$('#search').oninput = renderNotes;
$('#note-list').onclick = event => {
  const target = event.target as HTMLElement;
  if (target.closest('[data-note-menu]')) return;
  const file = target.closest<HTMLButtonElement>('[data-id]');
  if (file) { selectNote(file.dataset.id!); return; }
  const row = target.closest<HTMLButtonElement>('[data-folder]');
  if (row) {
    const folder = workspace.folders.find(f => f.id === row.dataset.folder)!;
    selectedFolderId = folder.id; folder.collapsed = !folder.collapsed; renderNotes(); persist();
  }
};
async function editFolderName(id?: string) {
  const folder = id ? workspace.folders.find(f => f.id === id) : null;
  const parentId = folder ? folder.parentId : selectedFolderId;
  if (!await confirmDialog(`<h2>${folder ? '重命名文件夹' : '新建文件夹'}</h2><label class="folder-name-label">文件夹名称<input id="folder-name" maxlength="100" required value="${escape(folder?.name ?? '新建文件夹')}" /></label>`)) return;
  const name = $<HTMLInputElement>('#folder-name').value.trim();
  if (!name || /[/\\]/.test(name)) { notify('文件夹名称不能为空，也不能包含斜杠。'); return; }
  if (workspace.folders.some(f => f.parentId === parentId && f.name === name && f.id !== id)) { notify('该位置已有同名文件夹。'); return; }
  if (folder) folder.name = name;
  else {
    const newFolder = { id: crypto.randomUUID(), name, parentId, collapsed: false };
    workspace.folders.push(newFolder); selectedFolderId = newFolder.id; revealFolder(parentId);
  }
  renderNotes(); persist();
}
$('#new-folder').onclick = () => editFolderName();
$('#note-list').ondblclick = event => {
  const row = (event.target as HTMLElement).closest<HTMLElement>('[data-folder]');
  if (row) editFolderName(row.dataset.folder);
};
$('.tree-root').onclick = event => {
  if (!(event.target as HTMLElement).closest('button')) { selectedFolderId = null; renderNotes(); }
};
$('.sidebar').addEventListener('dragstart', event => {
  const drag = event as DragEvent;
  if ((drag.target as HTMLElement).closest('[data-note-menu]')) { drag.preventDefault(); return; }
  const row = (drag.target as HTMLElement).closest<HTMLElement>('[data-id], [data-folder]');
  if (row && drag.dataTransfer) {
    drag.dataTransfer.effectAllowed = 'move';
    drag.dataTransfer.setData('text/plain', row.textContent ?? '');
    drag.dataTransfer.setData('application/x-mkdocsweb-item', JSON.stringify({ type: row.dataset.id ? 'note' : 'folder', id: row.dataset.id ?? row.dataset.folder }));
  }
});
$('.sidebar').addEventListener('dragover', event => {
  const drag = event as DragEvent;
  if (!drag.dataTransfer?.types.includes('application/x-mkdocsweb-item')) return;
  const target = (drag.target as HTMLElement).closest<HTMLElement>('[data-folder], [data-drop-root]');
  if (!target) return;
  drag.preventDefault(); drag.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.tree-drop-target').forEach(el => el.classList.remove('tree-drop-target'));
  target.classList.add('tree-drop-target');
});
$('.sidebar').addEventListener('dragleave', event => {
  const target = (event.target as HTMLElement).closest('.tree-drop-target');
  if (target && !target.contains((event as DragEvent).relatedTarget as Node)) target.classList.remove('tree-drop-target');
});
$('.sidebar').addEventListener('dragend', () => document.querySelectorAll('.tree-drop-target').forEach(el => el.classList.remove('tree-drop-target')));
$('.sidebar').addEventListener('drop', event => {
  const drag = event as DragEvent;
  const target = (drag.target as HTMLElement).closest<HTMLElement>('[data-folder], [data-drop-root]');
  if (!target) return;
  const raw = drag.dataTransfer?.getData('application/x-mkdocsweb-item');
  if (!raw) return;
  drag.preventDefault();
  const parentId = target.dataset.folder ?? null;
  try {
    const item = JSON.parse(raw);
    if (parentId !== null && !workspace.folders.some(f => f.id === parentId)) return;
    if (item.type === 'folder') {
      const folder = workspace.folders.find(f => f.id === item.id);
      if (!folder || !canMoveFolder(workspace.folders, folder.id, parentId)) return;
      if (workspace.folders.some(f => f.id !== folder.id && f.parentId === parentId && f.name === folder.name)) { notify('目标位置已有同名文件夹。'); return; }
      folder.parentId = parentId;
    } else if (item.type === 'note') {
      const note = workspace.notes.find(n => n.id === item.id);
      if (!note) return;
      note.folderId = parentId;
    } else return;
    selectedFolderId = parentId; revealFolder(parentId); renderNotes(); persist();
  } catch { notify('无法移动此项目。'); } finally { document.querySelectorAll('.tree-drop-target').forEach(el => el.classList.remove('tree-drop-target')); }
});
$('#import-folder').onclick = () => $<HTMLInputElement>('#directory-input').click();
$<HTMLInputElement>('#directory-input').onchange = async event => {
  const input = event.target as HTMLInputElement;
  const parentId = selectedFolderId;
  const files = Array.from(input.files ?? []).filter(file => /\.(md|markdown|txt)$/i.test(file.name));
  const importedNotes: { note: Workspace['notes'][number]; path: string }[] = [];
  let imported = 0;
  let lastId: string | null = null;
  for (const file of files) {
    if (file.size > 5 * 1024 * 1024) { notify(`${file.name} 超过 5 MB，未导入。`); continue; }
    try {
      const content = await file.text();
      const path = file.webkitRelativePath.split('/'); path.pop();
      const folderId = ensureFolderPath(workspace, path, parentId);
      const note = { id: crypto.randomUUID(), title: file.name.replace(/\.(md|markdown|txt)$/i, ''), content, folderId, updatedAt: Date.now() };
      workspace.notes.push(note); importedNotes.push({ note, path: file.webkitRelativePath }); lastId = note.id; imported++;
    } catch { notify(`无法读取 ${file.name}`); }
  }
  for (const { note, path } of importedNotes) {
    const prefix = path.replace(/\.(md|markdown|txt)$/i, '') + '.assets/';
    for (const image of Array.from(input.files ?? []).filter(file => file.webkitRelativePath.startsWith(prefix) && !file.webkitRelativePath.slice(prefix.length).includes('/') && /\.(png|jpe?g|gif|webp)$/i.test(file.name))) {
      try { (workspace.images ??= []).push(await createImageAsset(note, image, image.name)); } catch (error) { notify((error as Error).message); }
    }
  }
  if (lastId) selectNote(lastId);
  else { renderNotes(); persist(); }
  notify(imported ? `已按目录层级导入 ${imported} 份文档。` : '文件夹中未找到可导入的 Markdown 或 TXT 文档。');
  input.value = '';
};
$('#doc-title').oninput = () => { active().title = $<HTMLInputElement>('#doc-title').value; const previous = active().content; renameNoteImages(workspace, active()); if (active().content !== previous) { loading = true; editor.setMarkdown(active().content, false); loading = false; } active().updatedAt = Date.now(); $('#crumb-title').textContent = active().title || '未命名文档'; document.title = `${active().title || '未命名文档'} · MkDocs Web`; renderNotes(); persist(); };
$('#source-toggle').onclick = () => { sourceMode = !sourceMode; editor.changeMode(sourceMode ? 'markdown' : 'wysiwyg', true); $('#source-toggle').setAttribute('aria-pressed', String(sourceMode)); $('#source-toggle span').textContent = sourceMode ? '即时编辑' : '源码模式'; };
$('#sidebar-toggle').onclick = () => document.body.classList.toggle(window.innerWidth <= 700 ? 'sidebar-open' : 'sidebar-hidden');
$('#focus').onclick = () => { focusMode = !focusMode; document.body.classList.toggle('focus-mode', focusMode); $('#focus span').textContent = focusMode ? '退出专注' : '专注'; $('#focus').setAttribute('aria-pressed', String(focusMode)); };
$('#theme').onclick = () => { theme = theme === 'light' ? 'dark' : 'light'; document.documentElement.dataset.theme = theme; document.querySelectorAll('.toastui-editor-defaultUI, .editor-toolbar-mount').forEach(el => el.classList.toggle('toastui-editor-dark', theme === 'dark')); $('#theme').innerHTML = icon(theme === 'dark' ? 'sun' : 'moon'); $('#theme').setAttribute('aria-label', theme === 'dark' ? '切换浅色主题' : '切换深色主题'); refreshIcons(); workspace.settings = { ...workspace.settings, theme }; persist(); };
$('#export').onclick = () => { $('#export-menu').hidden = !$('#export-menu').hidden; $('#export').setAttribute('aria-expanded', String(!$('#export-menu').hidden)); };
$('#export-menu').onclick = event => { const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-export]'); if (button) { $('#export-menu').hidden = true; $('#export').setAttribute('aria-expanded', 'false'); exportNote(button.dataset.export!); } };
document.addEventListener('click', event => { if (!(event.target as HTMLElement).closest('.export-wrap')) { $('#export-menu').hidden = true; $('#export').setAttribute('aria-expanded', 'false'); } });
$('#import').onclick = () => $<HTMLInputElement>('#file-input').click();
$<HTMLInputElement>('#file-input').onchange = async event => {
  const input = event.target as HTMLInputElement;
  for (const file of Array.from(input.files ?? [])) {
    if (file.size > 5 * 1024 * 1024) { notify(`${file.name} 超过 5 MB，未导入。`); continue; }
    try { createNote(await file.text(), file.name.replace(/\.(md|markdown|txt)$/i, '')); } catch { notify(`无法读取 ${file.name}`); }
  }
  input.value = '';
};
$<HTMLInputElement>('#backup-input').onchange = async event => {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file) return;
  if (file.size > 20 * 1024 * 1024) { notify('备份文件超过 20 MB，无法恢复。'); input.value = ''; return; }
  try { const restored = parseWorkspace(await file.text()); if (!restored) throw new Error(); mergeWorkspace(workspace, restored); renderNotes(); persist(); notify(`已合并恢复 ${restored.notes.length} 份文档。`); } catch { notify('备份格式无效，当前文档未受影响。'); }
  input.value = '';
};
function confirmDialog(html: string): Promise<boolean> { $('#dialog-content').innerHTML = html; const dialog = $<HTMLDialogElement>('#dialog'); dialog.showModal(); return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true })); }
async function deleteNote(id: string) {
  const note = workspace.notes.find(n => n.id === id);
  if (!note) return;
  if (!await confirmDialog(`<h2>删除这份文档？</h2><p>「${escape(note.title || '未命名文档')}」将从当前账号中删除。你可以先导出留存。</p>`)) return;
  if (!workspace.notes.some(n => n.id === id)) return;
  const deletingActive = workspace.activeId === id;
  if (workspace.images) workspace.images = workspace.images.filter(a => a.noteId !== id);
  workspace.notes = workspace.notes.filter(n => n.id !== id);
  const cached = editors.get(id); editors.delete(id);
  cached?.instance.off('change');
  cached?.instance.destroy(); cached?.host.remove();
  if (!workspace.notes.length) createNote();
  else if (deletingActive) void selectNote(workspace.notes[0].id);
  else { renderNotes(); persist(); }
  notify('文档已删除');
}
$('#delete-note').onclick = () => { void deleteNote(workspace.activeId); };
$('#shortcuts').onclick = () => confirmDialog('<h2>写作快捷键</h2><p>⌘ / Ctrl + Shift + N　新建文档</p><p>⌘ / Ctrl + K　搜索文档</p><p>⌘ / Ctrl + S　保存至服务器</p><p>⌘ / Ctrl + /　切换源码模式</p><p>⌘ / Ctrl + B　加粗</p><p>⌘ / Ctrl + I　斜体</p><p>Esc　退出专注模式</p>');
$('#outline-list').onclick = event => { const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-heading]'); if (!button) return; if (sourceMode) $('#source-toggle').click(); const items = Array.from(document.querySelectorAll('.active-editor .toastui-editor-ww-container .toastui-editor-contents :is(h1,h2,h3,h4,h5,h6)')); items[Number(button.dataset.heading)]?.scrollIntoView({ behavior: 'smooth', block: 'start' }); $('#outline-list .current')?.classList.remove('current'); button.classList.add('current'); };
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { if (focusMode) $('#focus').click(); $('#export-menu').hidden = true; }
  if (!(event.metaKey || event.ctrlKey)) return;
  if (event.key.toLowerCase() === 'k') { event.preventDefault(); document.body.classList.remove('sidebar-hidden'); document.body.classList.add('sidebar-open'); if (focusMode) $('#focus').click(); $<HTMLInputElement>('#search').focus(); }
  if (event.key.toLowerCase() === 'n' && event.shiftKey) { event.preventDefault(); createNote(); }
  if (event.key.toLowerCase() === 's') { event.preventDefault(); persist(); void saver.flush().then(() => notify('文档已保存至服务器')).catch(() => {}); }
  if (event.key === '/') { event.preventDefault(); $('#source-toggle').click(); }
});
window.addEventListener('beforeunload', event => {
  if (sessionRedirecting()) return;
  if (imageUploads.size) { event.preventDefault(); event.returnValue = ''; return; }
  if (saveTimer || saver.dirty) { saver.enqueue(workspace); if (saver.dirty) { event.preventDefault(); event.returnValue = ''; } }
});
selectNote(workspace.activeId, false);
}

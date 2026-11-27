import Editor from '@toast-ui/editor';
import '@toast-ui/editor/dist/toastui-editor.css';
import '@toast-ui/editor/dist/theme/toastui-editor-dark.css';
import '@toast-ui/editor/dist/i18n/zh-cn';
import DOMPurify from 'dompurify';
import { createIcons, Plus, Search, FolderOpen, Upload, HardDrive, Moon, PanelLeft, Maximize, Download, ChevronDown, FileText, Trash2, PenLine, CodeXml, ListTree, Sparkles, Keyboard, CheckCheck, CircleAlert, Sun } from 'lucide';
import { filename, headings, parseWorkspace, readingStats, STORAGE_KEY, type Workspace } from './documents';
import { welcome } from './welcome';
import './style.css';

const icons = { Plus, Search, FolderOpen, Upload, HardDrive, Moon, PanelLeft, Maximize, Download, ChevronDown, FileText, Trash2, PenLine, CodeXml, ListTree, Sparkles, Keyboard, CheckCheck, CircleAlert, Sun };
const icon = (name: string, cls = '') => `<i data-lucide="${name}" class="${cls}"></i>`;
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
let storageHealthy = true;
let workspace: Workspace;
try {
  const stored = localStorage.getItem(STORAGE_KEY);
  const restored = parseWorkspace(stored);
  if (stored && !restored) { storageHealthy = false; }
  workspace = restored ?? initialWorkspace();
} catch { storageHealthy = false; workspace = initialWorkspace(); }
function initialWorkspace(): Workspace { return { activeId: 'welcome', notes: [{ id: 'welcome', title: '欢迎来到你的写作空间', content: welcome, updatedAt: Date.now() }] }; }
const active = () => workspace.notes.find(n => n.id === workspace.activeId)!;
let sourceMode = false;
let focusMode = false;
let theme = 'light';
try { theme = localStorage.getItem('mkdocsweb.theme') === 'dark' ? 'dark' : 'light'; } catch {}
document.documentElement.dataset.theme = theme;

$('#app').innerHTML = `
  <aside class="sidebar" aria-label="文档导航">
    <a class="brand" href="./" aria-label="MkDocs Web 首页"><span class="brand-mark">m<span>k</span></span><span>MkDocs <b>Web</b></span></a>
    <button class="new-note primary" id="new-note">${icon('plus')} 新建文档 <kbd>⇧ ⌘ N</kbd></button>
    <label class="search">${icon('search')}<input id="search" placeholder="搜索你的文档…" aria-label="搜索文档"/><kbd>⌘ K</kbd></label>
    <div class="section-label"><span>我的文档</span><span id="note-count"></span></div>
    <nav id="note-list" aria-label="我的文档"></nav>
    <div class="sidebar-bottom"><button id="import" class="import-button">${icon('folder-open')} 导入 Markdown ${icon('upload')}</button><div class="local-note">${icon('hard-drive')} 本地存储，安心写作</div><div class="sidebar-meta"><span>一个属于你的写作空间</span><button id="theme" class="icon-button" aria-label="切换深色主题" title="切换深色主题">${icon('moon')}</button></div></div>
  </aside>
  <main class="main">
    <header class="topbar"><div class="breadcrumb"><button id="sidebar-toggle" class="icon-button" aria-label="显示或隐藏文档列表">${icon('panel-left')}</button><span class="crumb-parent">我的文档</span><span class="slash">/</span><span id="crumb-title"></span></div><div class="top-actions"><span id="save-state" role="status"></span><button id="focus" class="text-button">${icon('maximize')}<span>专注</span></button><div class="export-wrap"><button id="export" class="export-button" aria-expanded="false">${icon('download')} 导出 ${icon('chevron-down')}</button><div id="export-menu" class="dropdown" hidden><button data-export="md">Markdown (.md)</button><button data-export="html">网页 (.html)</button><button data-export="print">打印 / 存为 PDF</button><button data-export="backup">备份所有文档 (.json)</button><button data-export="restore">恢复文档备份</button></div></div></div></header>
    <div class="work-area"><section class="writing-pane" aria-label="写作区"><div class="document-heading"><div class="eyebrow">你的文字，值得被认真对待</div><div class="title-row"><input id="doc-title" aria-label="文档标题" maxlength="100"/><button id="delete-note" class="icon-button" title="删除文档" aria-label="删除当前文档">${icon('trash-2')}</button></div><div class="document-meta">${icon('file-text')}<span>Markdown 文档</span><span class="meta-dot">·</span><span id="updated-at"></span></div></div><div class="editor-bar"><span class="editor-bar-label">${icon('pen-line')} 开始书写</span><button id="source-toggle" class="mode-toggle" aria-pressed="false">${icon('code-xml')}<span>源码模式</span></button></div><div id="editor"></div></section><aside class="outline" aria-label="文档大纲"><div class="outline-heading">${icon('list-tree')} 文档大纲</div><nav id="outline-list"></nav><div class="outline-tip">${icon('sparkles')}<p>让文字回归文字。<br/>让思绪自由流淌。</p><span>WRITE SOMETHING GOOD.</span></div></aside></div>
    <footer class="statusbar"><div><span class="status-dot"></span><span id="footer-state">所有更改已保存至本地</span></div><div><span id="word-count"></span><span class="status-divider">|</span><span id="read-time"></span><span class="status-divider">|</span><span>UTF-8</span><span class="status-divider">|</span><button id="shortcuts">${icon('keyboard')} 快捷键</button></div></footer>
  </main><input id="file-input" type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" multiple hidden/><input id="backup-input" type="file" accept=".json,application/json" hidden/><div id="toast" role="status" hidden></div><dialog id="dialog"><form method="dialog"><div id="dialog-content"></div><div class="dialog-actions"><button value="cancel">取消</button><button value="confirm" class="primary">确定</button></div></form></dialog>`;

function makeEditor(content: string) {
  return new Editor({ el: $('#editor'), height: '100%', initialEditType: sourceMode ? 'markdown' : 'wysiwyg', previewStyle: 'vertical', initialValue: content, language: 'zh-CN', usageStatistics: false, hideModeSwitch: true, theme, autofocus: false, toolbarItems: [['heading', 'bold', 'italic', 'strike'], ['hr', 'quote'], ['ul', 'ol', 'task'], ['table', 'link'], ['code', 'codeblock']], hooks: { addImageBlobHook: () => false } });
}
let editor = makeEditor(active().content);
let loading = false;
let saveTimer: ReturnType<typeof setTimeout>;
let toastTimer: ReturnType<typeof setTimeout>;
editor.on('change', onChange);
function refreshIcons() { createIcons({ icons, attrs: { 'stroke-width': 1.65 } }); }
function notify(message: string) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => $('#toast').hidden = true, 3500); }
function setSaveState(saved: boolean) {
  $('#save-state').innerHTML = `${icon(saved ? 'check-check' : 'circle-alert')}<span>${saved ? '已保存' : '未保存'}</span>`;
  $('#footer-state').textContent = saved ? '所有更改已保存至本地' : '尚未保存，请导出文档备份';
  refreshIcons();
}
function persist() {
  clearTimeout(saveTimer);
  if (!storageHealthy) { setSaveState(false); return false; }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace)); setSaveState(true); return true; }
  catch { setSaveState(false); notify('本地存储不可用或空间已满，请导出备份。'); return false; }
}
function onChange() {
  if (loading || !editor) return;
  active().content = editor.getMarkdown(); active().updatedAt = Date.now();
  renderStats(); renderOutline();
  $('#save-state').textContent = '保存中…';
  $('#footer-state').textContent = '正在保存更改…';
  clearTimeout(saveTimer); saveTimer = setTimeout(() => { persist(); renderNotes(); }, 350);
}
function renderStats() {
  const stats = readingStats(active().content);
  $('#word-count').textContent = `${stats.characters.toLocaleString()} 字符`;
  $('#read-time').textContent = `约 ${stats.minutes} 分钟阅读`;
  $('#updated-at').textContent = `编辑于 ${new Date(active().updatedAt).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}`;
}
function renderNotes() {
  const term = $<HTMLInputElement>('#search').value.toLocaleLowerCase();
  const notes = workspace.notes.filter(n => `${n.title}\n${n.content}`.toLocaleLowerCase().includes(term));
  $('#note-count').textContent = String(workspace.notes.length).padStart(2, '0');
  $('#note-list').innerHTML = notes.map(n => `<button class="note-item ${n.id === workspace.activeId ? 'active' : ''}" data-id="${escape(n.id)}" ${n.id === workspace.activeId ? 'aria-current="page"' : ''}>${icon('file-text')}<span><strong>${escape(n.title || '未命名文档')}</strong><small>${n.content.replace(/[#*>`_\[\]\n-]/g, ' ').trim().slice(0, 34) ? escape(n.content.replace(/[#*>`_\[\]\n-]/g, ' ').trim().slice(0, 34)) : '从这里，写下第一个想法…'}</small></span></button>`).join('') || '<p class="empty-search">没有找到匹配的文档</p>';
  refreshIcons();
}
function renderOutline() {
  const list = headings(active().content);
  $('#outline-list').innerHTML = list.map((h, index) => `<button data-heading="${index}" style="--level:${Math.min(h.level, 4)}" class="${index === 0 ? 'current' : ''}">${escape(h.text)}</button>`).join('') || '<p class="empty-search">添加标题后，大纲将显示在这里</p>';
}
function selectNote(id: string) {
  persist(); workspace.activeId = id; loading = true;
  // Each document owns a fresh editor history, so undo cannot restore another document.
  editor.destroy(); editor = makeEditor(active().content); editor.on('change', onChange); editor.moveCursorToStart(false); loading = false;
  $<HTMLInputElement>('#doc-title').value = active().title; $('#crumb-title').textContent = active().title || '未命名文档';
  document.title = `${active().title || '未命名文档'} · MkDocs Web`;
  renderNotes(); renderStats(); renderOutline(); persist();
}
function createNote(content = '', title = '未命名文档') {
  const note = { id: crypto.randomUUID(), title, content, updatedAt: Date.now() };
  workspace.notes.unshift(note); selectNote(note.id); $<HTMLInputElement>('#doc-title').focus(); $<HTMLInputElement>('#doc-title').select();
}
function download(content: string, name: string, type: string) { const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function exportNote(format: string) {
  if (format === 'restore') { $<HTMLInputElement>('#backup-input').click(); return; }
  if (format === 'backup') { download(JSON.stringify(workspace, null, 2), 'mkdocsweb-backup.json', 'application/json'); return; }
  if (format === 'print') { if (sourceMode) $('#source-toggle').click(); window.print(); return; }
  if (format === 'md') download(active().content, `${filename(active().title)}.md`, 'text/markdown;charset=utf-8');
  else { const html = DOMPurify.sanitize(editor.getHTML()); download(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(active().title)}</title><style>body{max-width:800px;margin:60px auto;padding:0 24px;font:17px/1.85 system-ui;color:#29342e}pre{overflow:auto;padding:20px;background:#f4f6f5}code{font-family:monospace}blockquote{border-left:3px solid #6a927b;margin-left:0;padding-left:20px;color:#66756c}table{border-collapse:collapse;width:100%}td,th{padding:10px;border:1px solid #ddd}img{max-width:100%}</style><body>${html}</body></html>`, `${filename(active().title)}.html`, 'text/html;charset=utf-8'); }
  notify('已导出，文字随你带走。');
}
$('#new-note').onclick = () => createNote();
$('#search').oninput = renderNotes;
$('#note-list').onclick = event => { const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-id]'); if (button) selectNote(button.dataset.id!); };
$('#doc-title').oninput = () => { active().title = $<HTMLInputElement>('#doc-title').value; active().updatedAt = Date.now(); $('#crumb-title').textContent = active().title || '未命名文档'; document.title = `${active().title || '未命名文档'} · MkDocs Web`; renderNotes(); persist(); };
$('#source-toggle').onclick = () => { sourceMode = !sourceMode; editor.changeMode(sourceMode ? 'markdown' : 'wysiwyg', true); $('#source-toggle').setAttribute('aria-pressed', String(sourceMode)); $('#source-toggle span').textContent = sourceMode ? '即时编辑' : '源码模式'; };
$('#sidebar-toggle').onclick = () => document.body.classList.toggle(window.innerWidth <= 700 ? 'sidebar-open' : 'sidebar-hidden');
$('#focus').onclick = () => { focusMode = !focusMode; document.body.classList.toggle('focus-mode', focusMode); $('#focus span').textContent = focusMode ? '退出专注' : '专注'; $('#focus').setAttribute('aria-pressed', String(focusMode)); };
$('#theme').onclick = () => { theme = theme === 'light' ? 'dark' : 'light'; document.documentElement.dataset.theme = theme; $('.toastui-editor-defaultUI').classList.toggle('toastui-editor-dark', theme === 'dark'); $('#theme').innerHTML = icon(theme === 'dark' ? 'sun' : 'moon'); $('#theme').setAttribute('aria-label', theme === 'dark' ? '切换浅色主题' : '切换深色主题'); refreshIcons(); try { localStorage.setItem('mkdocsweb.theme', theme); } catch {} };
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
  try { const restored = parseWorkspace(await file.text()); if (!restored) throw new Error(); for (const note of restored.notes) workspace.notes.push({ ...note, id: crypto.randomUUID() }); renderNotes(); persist(); notify(`已合并恢复 ${restored.notes.length} 份文档。`); } catch { notify('备份格式无效，当前文档未受影响。'); }
  input.value = '';
};
function confirmDialog(html: string): Promise<boolean> { $('#dialog-content').innerHTML = html; const dialog = $<HTMLDialogElement>('#dialog'); dialog.showModal(); return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true })); }
$('#delete-note').onclick = async () => { if (await confirmDialog(`<h2>删除这份文档？</h2><p>「${escape(active().title || '未命名文档')}」将从浏览器中删除。你可以先导出留存。</p>`)) { workspace.notes = workspace.notes.filter(n => n.id !== workspace.activeId); if (!workspace.notes.length) createNote(); else selectNote(workspace.notes[0].id); notify('文档已删除'); } };
$('#shortcuts').onclick = () => confirmDialog('<h2>写作快捷键</h2><p>⌘ / Ctrl + Shift + N　新建文档</p><p>⌘ / Ctrl + K　搜索文档</p><p>⌘ / Ctrl + S　保存至本地</p><p>⌘ / Ctrl + /　切换源码模式</p><p>⌘ / Ctrl + B　加粗</p><p>⌘ / Ctrl + I　斜体</p><p>Esc　退出专注模式</p>');
$('#outline-list').onclick = event => { const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-heading]'); if (!button) return; if (sourceMode) $('#source-toggle').click(); const items = Array.from(document.querySelectorAll('.toastui-editor-ww-container .toastui-editor-contents h1, .toastui-editor-ww-container .toastui-editor-contents h2, .toastui-editor-ww-container .toastui-editor-contents h3, .toastui-editor-ww-container .toastui-editor-contents h4, .toastui-editor-ww-container .toastui-editor-contents h5, .toastui-editor-ww-container .toastui-editor-contents h6')); items[Number(button.dataset.heading)]?.scrollIntoView({ behavior: 'smooth', block: 'start' }); $('#outline-list .current')?.classList.remove('current'); button.classList.add('current'); };
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { if (focusMode) $('#focus').click(); $('#export-menu').hidden = true; }
  if (!(event.metaKey || event.ctrlKey)) return;
  if (event.key.toLowerCase() === 'k') { event.preventDefault(); document.body.classList.remove('sidebar-hidden'); document.body.classList.add('sidebar-open'); if (focusMode) $('#focus').click(); $<HTMLInputElement>('#search').focus(); }
  if (event.key.toLowerCase() === 'n' && event.shiftKey) { event.preventDefault(); createNote(); }
  if (event.key.toLowerCase() === 's') { event.preventDefault(); if (persist()) notify('文档已保存至当前浏览器'); }
  if (event.key === '/') { event.preventDefault(); $('#source-toggle').click(); }
});
window.addEventListener('beforeunload', persist);
window.addEventListener('storage', event => { if (event.key === STORAGE_KEY) { storageHealthy = false; clearTimeout(saveTimer); setSaveState(false); notify('其他标签页更新了文档，当前页已暂停保存。请导出未保存内容后刷新。'); } });
selectNote(workspace.activeId);
if (!storageHealthy) notify('无法读取本地存储。为保护原始数据，自动保存已暂停，请导出当前文档。');

import './style.css';
import { api, APIError, setSession, type Session } from './api';
import { parseWorkspace, type Workspace } from './documents';
const app = document.querySelector<HTMLElement>('#app')!;
function login(message = '') {
  app.className = 'auth-shell';
  app.innerHTML = `<form class="auth-card"><div class="auth-brand">MkDocs <b>Web</b></div><h1>登录写作空间</h1><p>使用管理员为你创建的账号登录。</p><label>用户名<input name="username" autocomplete="username" required maxlength="40" /></label><label>密码<input name="password" type="password" autocomplete="current-password" required maxlength="128" /></label><p class="auth-error" role="alert"></p><button class="primary" type="submit">登录</button><small>本站不开放注册 · 文档与 Git 连接按账号隔离</small></form>`;
  const form = app.querySelector('form')!; const error = app.querySelector<HTMLElement>('[role=alert]')!; error.textContent = message;
  form.onsubmit = async event => {
    event.preventDefault(); const button = form.querySelector('button')!; button.disabled = true; error.textContent = '';
    const data = new FormData(form);
    try { const session = await api<Session>('/auth/login', 'POST', { username: data.get('username'), password: data.get('password') }, false); (form.elements.namedItem('password') as HTMLInputElement).value = ''; setSession(session); await start(session); }
    catch (e) { error.textContent = (e as Error).message; } finally { button.disabled = false; }
  };
}
async function start(session: Session) {
  setSession(session);
  const result = await api<{ revision: number; workspace: Workspace | null }>('/workspace');
  const workspace = result.workspace === null ? null : parseWorkspace(JSON.stringify(result.workspace));
  if (result.workspace !== null && !workspace) throw new Error('服务器文档格式异常，已暂停加载以保护原始数据。');
  const { mountEditor } = await import('./editor'); app.className = ''; mountEditor(workspace, result.revision, session);
}
app.className = 'auth-shell'; app.textContent = '正在连接写作空间…';
void api<Session>('/auth/session', 'GET', undefined, false).then(start).catch(error => {
  login(error instanceof APIError && error.status === 401 ? '' : `无法连接后端：${error.message}`);
});

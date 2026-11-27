import { api, type Account, type Session } from './api';
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function accountPanel(session: Session, flush: () => Promise<void>) {
  const dialog = document.createElement('dialog'); dialog.className = 'account-dialog'; document.body.append(dialog);
  dialog.innerHTML = `<div class="git-heading"><h2>账号管理</h2><button class="git-close" aria-label="关闭">×</button></div><p>当前账号：${esc(session.user.username)} · ${session.user.role === 'admin' ? '管理员' : '用户'}</p><p class="git-help">文档与 Git 连接仅属于当前账号。退出前会先保存文档。</p><button id="logout">保存并退出登录</button><h3>修改密码</h3><form id="password-form"><label>当前密码<input name="currentPassword" type="password" autocomplete="current-password" maxlength="128" required /></label><label>新密码<input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required /></label><button class="primary">修改密码并重新登录</button></form>${session.user.role === 'admin' ? `<h3>用户管理</h3><p class="git-help">不开放注册。管理员可创建、停用用户及重置密码；更改账号权限或密码会使该用户的已有会话失效。</p><div id="user-list"></div><h3>创建用户</h3><form id="create-user"><label>用户名<input name="username" pattern="[a-z0-9_-]{3,40}" required autocomplete="off" placeholder="3–40 位字母、数字、下划线或连字符" /></label><label>初始密码<input name="password" type="password" minlength="12" maxlength="128" required autocomplete="new-password" /></label><label>角色<select name="role"><option value="user">普通用户</option><option value="admin">管理员</option></select></label><button class="primary">创建用户</button></form>` : ''}<p id="account-status" role="status"></p>`;
  const status = dialog.querySelector<HTMLElement>('#account-status')!;
  let busy = false;
  async function run(action: () => Promise<void>) {
    if (busy) return; busy = true; status.textContent = '';
    dialog.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input,button,select').forEach(x => x.disabled = true);
    try { await action(); } catch (e) { status.textContent = (e as Error).message; } finally { busy = false; dialog.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input,button,select').forEach(x => x.disabled = false); }
  }
  dialog.querySelector<HTMLButtonElement>('.git-close')!.onclick = () => dialog.close();
  dialog.addEventListener('cancel', e => { if (busy) e.preventDefault(); });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.querySelector<HTMLButtonElement>('#logout')!.onclick = () => run(async () => { await flush(); await api('/auth/logout', 'POST'); location.reload(); });
  dialog.querySelector<HTMLFormElement>('#password-form')!.onsubmit = event => {
    event.preventDefault(); const form = event.currentTarget as HTMLFormElement; const data = Object.fromEntries(new FormData(form));
    void run(async () => { await flush(); await api('/auth/password', 'POST', data); form.reset(); location.reload(); });
  };
  async function users() {
    const list = await api<Account[]>('/admin/users'); const container = dialog.querySelector<HTMLElement>('#user-list')!;
    container.innerHTML = list.map(u => `<div class="account-user"><strong>${esc(u.username)}</strong><span>${u.role === 'admin' ? '管理员' : '用户'} · ${u.disabled ? '已停用' : '启用'}</span><div><button data-disable="${esc(u.id)}">${u.disabled ? '启用' : '停用'}</button><button data-role="${esc(u.id)}">${u.role === 'admin' ? '改为普通用户' : '设为管理员'}</button><button data-reset="${esc(u.id)}">重置密码</button></div><form data-password-form="${esc(u.id)}" hidden><input name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" placeholder="新密码，至少 12 字节" required /><button>确认重置</button></form></div>`).join('');
    container.querySelectorAll<HTMLButtonElement>('[data-disable], [data-role]').forEach(button => button.onclick = () => {
      const u = list.find(x => x.id === (button.dataset.disable || button.dataset.role))!;
      void run(async () => { await flush(); await api(`/admin/users/${u.id}`, 'PATCH', button.dataset.disable ? { disabled: !u.disabled } : { role: u.role === 'admin' ? 'user' : 'admin' }); if (u.id === session.user.id) location.reload(); else { await users(); status.textContent = '用户已更新。'; } });
    });
    container.querySelectorAll<HTMLButtonElement>('[data-reset]').forEach(button => button.onclick = () => { const form = container.querySelector<HTMLFormElement>(`[data-password-form="${button.dataset.reset}"]`)!; form.hidden = !form.hidden; });
    container.querySelectorAll<HTMLFormElement>('[data-password-form]').forEach(form => form.onsubmit = event => { event.preventDefault(); const password = new FormData(form).get('password'); void run(async () => { await flush(); await api(`/admin/users/${form.dataset.passwordForm}`, 'PATCH', { password }); form.reset(); if (form.dataset.passwordForm === session.user.id) location.reload(); else { await users(); status.textContent = '密码已重置，该用户需重新登录。'; } }); });
  }
  if (session.user.role === 'admin') {
    void run(users);
    dialog.querySelector<HTMLFormElement>('#create-user')!.onsubmit = event => { event.preventDefault(); const form = event.currentTarget as HTMLFormElement; const data = Object.fromEntries(new FormData(form)); void run(async () => { await api('/admin/users', 'POST', data); form.reset(); await users(); status.textContent = '用户已创建。'; }); };
  }
  dialog.showModal();
}

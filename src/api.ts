export interface Account { id: string; username: string; role: 'admin' | 'user'; disabled: boolean }
export interface Session { user: Account; csrf: string }
let csrf = '';
let userID = '';
let redirecting = false;
export function sessionRedirecting() { return redirecting; }
export function setSession(session: Session) { csrf = session.csrf; userID = session.user.id; }
export class APIError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }
export async function api<T>(path: string, method = 'GET', body?: unknown, redirectOnExpiry = true): Promise<T> {
  const response = await fetch(`/api${path}`, { method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { ...(userID ? { 'X-Session-User': userID } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'X-CSRF-Token': csrf } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(90000) });
  if (!response.headers.get('Content-Type')?.includes('application/json')) throw new APIError(502, '后端未连接，请通过后端服务地址访问。');
  const value = await response.json();
  if (!response.ok) {
    if (response.status === 401 && redirectOnExpiry) { redirecting = true; document.body.replaceChildren(); location.reload(); }
    throw new APIError(response.status, value.error || `请求失败 (${response.status})`);
  }
  return value as T;
}
export const gitFetch: typeof fetch = async (input, options) => {
  const path = String(input).replace('https://api.github.com', '');
  const authorization = new Headers(options?.headers).get('Authorization');
  const result = await api<{ status: number; data: unknown }>('/git/request', 'POST', { path, method: options?.method || 'GET', ...(options?.body ? { body: JSON.parse(String(options.body)) } : {}), ...(authorization ? { token: authorization.replace(/^Bearer /, '') } : {}) });
  return new Response(JSON.stringify(result.data), { status: result.status, headers: { 'Content-Type': 'application/json' } });
};

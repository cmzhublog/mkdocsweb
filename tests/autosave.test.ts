import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceSaver } from '../src/autosave.ts';
import { setSession } from '../src/api.ts';

test('服务端确认后才显示已保存，连续编辑串行保存最新版本', async () => {
  const original = globalThis.fetch; const bodies: { revision: number; workspace: unknown }[] = [];
  let release!: () => void; const gate = new Promise<void>(resolve => release = resolve);
  setSession({ user: { id: 'alice', username: 'alice', role: 'user', disabled: false }, csrf: 'csrf' });
  globalThis.fetch = async (_url, options) => { const headers = new Headers(options?.headers); assert.equal(headers.get('X-Session-User'), 'alice'); assert.equal(headers.get('X-CSRF-Token'), 'csrf'); bodies.push(JSON.parse(String(options?.body))); if (bodies.length === 1) await gate; return new Response(JSON.stringify({ revision: bodies.length }), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  try {
    const states: boolean[] = []; const saver = new WorkspaceSaver(0, { text: 'old' }, saved => states.push(saved));
    saver.enqueue({ text: 'first' }); const saving = saver.flush(); saver.enqueue({ text: 'second' }); saver.enqueue({ text: 'latest' });
    assert.equal(states.includes(true), false); assert.equal(saver.dirty, true); release(); await saving;
    assert.deepEqual(bodies, [{ revision: 0, workspace: { text: 'first' } }, { revision: 1, workspace: { text: 'latest' } }]); assert.equal(saver.dirty, false); assert.equal(states.at(-1), true);
  } finally { globalThis.fetch = original; }
});

test('版本冲突保留待保存内容并暂停重试，避免覆盖其他窗口', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ error: '版本冲突' }), { status: 409, headers: { 'Content-Type': 'application/json' } }); };
  try { let message = ''; const saver = new WorkspaceSaver(4, {}, (_saved, error) => { if (error) message = error; }); saver.enqueue({ text: 'unsaved' }); await assert.rejects(saver.flush(), /版本冲突/); assert.equal(saver.dirty, true); assert.equal(message, '版本冲突'); await assert.rejects(saver.flush(), /暂停/); assert.equal(calls, 1); } finally { globalThis.fetch = original; }
});

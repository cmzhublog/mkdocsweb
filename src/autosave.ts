import { api } from './api.ts';
export class WorkspaceSaver {
  private pending: string | null = null;
  private running: Promise<void> | null = null;
  private last: string;
  private blocked = false;
  private revision: number;
  private status: (saved: boolean, error?: string) => void;
  constructor(revision: number, initial: unknown, status: (saved: boolean, error?: string) => void) { this.revision = revision; this.status = status; this.last = JSON.stringify(initial); }
  get dirty() { return this.pending !== null || this.running !== null; }
  enqueue(workspace: unknown) { const raw = JSON.stringify(workspace); if (this.pending === null && !this.running && raw === this.last) return; this.pending = raw; this.status(false); }
  async flush(): Promise<void> {
    if (this.blocked) throw new Error('自动保存已暂停，请先导出备份再刷新。');
    if (this.running) { await this.running; if (this.pending !== null) return this.flush(); return; }
    this.running = (async () => {
      while (this.pending !== null) {
        const raw = this.pending; this.pending = null;
        try { const result = await api<{ revision: number }>('/workspace', 'PUT', { revision: this.revision, workspace: JSON.parse(raw) }); this.revision = result.revision; this.last = raw; }
        catch (error) { if (this.pending === null) this.pending = raw; this.blocked = true; this.status(false, (error as Error).message); throw error; }
      }
      this.status(true);
    })();
    try { await this.running; } finally { this.running = null; }
  }
}

// services/agent-framework/memory/in-memory-store.ts
// AT24 Agent Framework - A7. Process-local MemoryStore. Used by the
// validation harness and as a stand-in until the AgentMemoryRecord migration
// is applied. Deterministic ordering: newest first by createdAt.

import type { MemoryStore, StoredMemoryRecord, NewMemoryRecord, MemoryQuery } from "./memory-store";

export class InMemoryStore implements MemoryStore {
  private rows: StoredMemoryRecord[] = [];
  private seq = 0;

  async insert(rec: NewMemoryRecord): Promise<StoredMemoryRecord> {
    const now = new Date(Date.now() + this.seq).toISOString(); // stable strict ordering
    this.seq += 1;
    const row: StoredMemoryRecord = { ...rec, id: `mem_${this.seq}`, createdAt: now, updatedAt: now };
    this.rows.push(row);
    return { ...row };
  }

  async query(q: MemoryQuery): Promise<StoredMemoryRecord[]> {
    let out = this.rows.filter((r) => r.userId === q.userId && r.layer === q.layer);
    if (q.agentId) out = out.filter((r) => r.agentId === q.agentId);
    if (q.agentType) out = out.filter((r) => r.agentType === q.agentType);
    if (q.scope !== undefined) out = out.filter((r) => r.scope === q.scope);
    if (q.key !== undefined) out = out.filter((r) => r.key === q.key);
    if (q.status) out = out.filter((r) => r.status === q.status);
    if (q.notExpiredAsOf) out = out.filter((r) => !r.expiresAt || r.expiresAt > q.notExpiredAsOf!);
    out = out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return (q.limit ? out.slice(0, q.limit) : out).map((r) => ({ ...r }));
  }

  async getById(id: string): Promise<StoredMemoryRecord | null> {
    const r = this.rows.find((x) => x.id === id);
    return r ? { ...r } : null;
  }

  async markStatus(id: string, status: StoredMemoryRecord["status"]): Promise<void> {
    const r = this.rows.find((x) => x.id === id);
    if (r) {
      r.status = status;
      r.updatedAt = new Date(Date.now() + this.seq++).toISOString();
    }
  }

  async clearForUser(userId: string): Promise<number> {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => r.userId !== userId);
    return before - this.rows.length;
  }
}

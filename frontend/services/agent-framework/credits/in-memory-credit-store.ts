// services/agent-framework/credits/in-memory-credit-store.ts
// AT24 Agent Framework - A9. Process-local CreditStore for tests and as a
// stand-in until the AgentCreditLedgerEntry migration is applied.

import {
  type CreditStore,
  type StoredLedgerEntry,
  type NewLedgerEntry,
  DuplicateLedgerEntryError,
} from "./credit-store";

export class InMemoryCreditStore implements CreditStore {
  private rows: StoredLedgerEntry[] = [];
  private seq = 0;

  async insert(entry: NewLedgerEntry): Promise<StoredLedgerEntry> {
    if (this.rows.some((r) => r.idempotencyKey === entry.idempotencyKey)) {
      throw new DuplicateLedgerEntryError(entry.idempotencyKey);
    }
    this.seq += 1;
    const row: StoredLedgerEntry = {
      ...entry,
      stepId: entry.stepId ?? null,
      toolCallId: entry.toolCallId ?? null,
      id: `led_${this.seq}`,
      createdAt: new Date(Date.now() + this.seq).toISOString(),
    };
    this.rows.push(row);
    return { ...row };
  }

  async findByIdempotencyKey(key: string): Promise<StoredLedgerEntry | null> {
    const r = this.rows.find((x) => x.idempotencyKey === key);
    return r ? { ...r } : null;
  }

  async sumForPeriod(userId: string, periodStart: string): Promise<number> {
    return this.rows
      .filter((r) => r.userId === userId && r.periodStart >= periodStart)
      .reduce((s, r) => s + r.amount, 0);
  }

  async entriesForRun(runId: string): Promise<StoredLedgerEntry[]> {
    return this.rows
      .filter((r) => r.runId === runId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
      .map((r) => ({ ...r }));
  }

  async clearForUser(userId: string): Promise<number> {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => r.userId !== userId);
    return before - this.rows.length;
  }
}

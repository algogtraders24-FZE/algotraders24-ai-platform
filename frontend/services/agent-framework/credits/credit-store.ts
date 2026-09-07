// services/agent-framework/credits/credit-store.ts
// AT24 Agent Framework - A9. The persistence PORT the CreditLedger depends
// on. Two impls: PrismaCreditStore (the real AgentCreditLedgerEntry table,
// once its migration is applied) and InMemoryCreditStore (tests + stand-in).
// The ledger never touches Prisma directly.

import type { AgentCreditEntryKind, AgentCreditLedgerEntry } from "@/types/agent-framework";

export type StoredLedgerEntry = AgentCreditLedgerEntry;

export interface NewLedgerEntry {
  userId: string;
  runId: string;
  stepId?: string | null;
  toolCallId?: string | null;
  kind: AgentCreditEntryKind;
  amount: number;
  balanceAfter: number;
  idempotencyKey: string;
  reason: string;
  periodStart: string;
}

export interface CreditStore {
  /** Insert one entry. Throws a DUPLICATE error if idempotencyKey already
   *  exists - the ledger catches it and treats the charge as already applied. */
  insert(entry: NewLedgerEntry): Promise<StoredLedgerEntry>;
  findByIdempotencyKey(key: string): Promise<StoredLedgerEntry | null>;
  /** Sum of `amount` for a user within [periodStart, +inf). */
  sumForPeriod(userId: string, periodStart: string): Promise<number>;
  entriesForRun(runId: string): Promise<StoredLedgerEntry[]>;
  /** test-only. */
  clearForUser(userId: string): Promise<number>;
}

/** Thrown by a store's insert() when the idempotencyKey already exists. */
export class DuplicateLedgerEntryError extends Error {
  constructor(public readonly idempotencyKey: string) {
    super(`ledger entry with idempotencyKey "${idempotencyKey}" already exists`);
    this.name = "DuplicateLedgerEntryError";
  }
}

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
  /**
   * Runs `fn` with exclusive access for this userId - a real impl must
   * guarantee no two calls for the same userId can have their `fn`
   * bodies interleave (e.g. a DB advisory lock held for fn's duration).
   * Needed because the idempotency-key de-dupe in charge() only prevents
   * the SAME charge applying twice; it does nothing for two DIFFERENT
   * legitimate charges racing each other's balance check (both read the
   * same consumed sum before either insert commits, both pass, both
   * insert - overdrawing the allowance). Returns null if exclusive
   * access could not be acquired - the caller is expected to retry
   * rather than proceed without the guarantee.
   */
  withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T | null>;
}

/** Thrown by a store's insert() when the idempotencyKey already exists. */
export class DuplicateLedgerEntryError extends Error {
  constructor(public readonly idempotencyKey: string) {
    super(`ledger entry with idempotencyKey "${idempotencyKey}" already exists`);
    this.name = "DuplicateLedgerEntryError";
  }
}

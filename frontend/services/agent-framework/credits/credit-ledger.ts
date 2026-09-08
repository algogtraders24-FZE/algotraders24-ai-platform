// services/agent-framework/credits/credit-ledger.ts
// AT24 Agent Framework - A9. The ACCOUNTING authority for agent credits.
//
// LOCKED (owner G08):
//   Account (allowance) -> immutable ledger -> deterministic balance ->
//   run/tool correlation -> idempotent charge -> auditable history.
//
// This is NOT `run.creditsConsumed += cost`. That field stays as the BUDGET
// counter feeding A8's maxCreditCost guardrail. The ledger is separate:
//   - balance  = allowance - SUM(ledger amounts this period), recomputed fresh
//   - canAfford = balance >= amount
//   - charge   = atomic, idempotent (unique idempotencyKey), never negative
//   - refund   = a signed (negative-amount) entry
//   - historyForRun = the full per-run audit
//
// A9 makes no pricing decision - per-tool amounts are the placeholder costs
// the ToolGateway already computes; the ledger records whatever it is given.

import { logger } from "@/services/backend/Logger";
import { type AgentCreditEntryKind } from "@/types/agent-framework";
import {
  type CreditStore,
  type StoredLedgerEntry,
  DuplicateLedgerEntryError,
} from "./credit-store";
import {
  type AllowanceResolver,
  PlanAllowanceResolver,
} from "./allowance-resolver";
import { InMemoryCreditStore } from "./in-memory-credit-store";

const log = logger.child("agent-credits");

export class InsufficientCreditsError extends Error {
  constructor(public readonly userId: string, public readonly needed: number, public readonly available: number) {
    super(`insufficient credits: need ${needed}, have ${available}`);
    this.name = "InsufficientCreditsError";
  }
}

export interface CreditBalance {
  allowance: number;
  consumed: number;
  balance: number;
  planId: string;
  periodStart: string;
  periodEnd: string;
}

export interface ChargeRequest {
  userId: string;
  runId: string;
  stepId?: string | null;
  toolCallId?: string | null;
  kind: AgentCreditEntryKind;
  /** the amount to debit. Must be >= 0. */
  amount: number;
  reason: string;
  /** unique per logical charge - a resumed tick re-uses the SAME key and is
   *  NOT charged twice. Derive from (runId, plan step index), never from a
   *  fresh toolCallId. */
  idempotencyKey: string;
}

export interface ChargeResult {
  charged: boolean;
  /** true when this exact charge had already been applied (idempotent no-op). */
  alreadyApplied: boolean;
  entry: StoredLedgerEntry | null;
  balance: CreditBalance;
}

export class CreditLedger {
  private readonly store: CreditStore;
  private readonly allowances: AllowanceResolver;

  constructor(deps: { store?: CreditStore; allowances?: AllowanceResolver } = {}) {
    this.store = deps.store ?? new InMemoryCreditStore();
    this.allowances = deps.allowances ?? new PlanAllowanceResolver();
  }

  /** Authoritative balance - recomputed from the allowance minus the period
   *  ledger sum every time. Never cached. */
  async balance(userId: string): Promise<CreditBalance> {
    const a = await this.allowances.resolve(userId);
    const consumed = await this.store.sumForPeriod(userId, a.periodStart);
    return {
      allowance: a.allowance,
      consumed,
      balance: a.allowance - consumed,
      planId: a.planId,
      periodStart: a.periodStart,
      periodEnd: a.periodEnd,
    };
  }

  async canAfford(userId: string, amount: number): Promise<boolean> {
    if (amount <= 0) return true;
    return (await this.balance(userId)).balance >= amount;
  }

  /**
   * Atomically debit `amount` for one logical operation.
   *  - amount < 0 is rejected (use refund()).
   *  - if the idempotencyKey already exists -> no-op, alreadyApplied: true.
   *  - if the balance is insufficient -> InsufficientCreditsError (deterministic,
   *    no partial write, no negative balance).
   */
  async charge(req: ChargeRequest): Promise<ChargeResult> {
    if (req.amount < 0) throw new Error("charge amount must be >= 0; use refund() for corrections");

    const existing = await this.store.findByIdempotencyKey(req.idempotencyKey);
    if (existing) {
      log.info("credit charge idempotent no-op", { userId: req.userId, runId: req.runId, idempotencyKey: req.idempotencyKey });
      return { charged: false, alreadyApplied: true, entry: existing, balance: await this.balance(req.userId) };
    }

    const a = await this.allowances.resolve(req.userId);
    const consumed = await this.store.sumForPeriod(req.userId, a.periodStart);
    const available = a.allowance - consumed;

    if (req.amount > 0 && available < req.amount) {
      throw new InsufficientCreditsError(req.userId, req.amount, available);
    }

    const balanceAfter = available - req.amount;
    try {
      const entry = await this.store.insert({
        userId: req.userId,
        runId: req.runId,
        stepId: req.stepId ?? null,
        toolCallId: req.toolCallId ?? null,
        kind: req.kind,
        amount: req.amount,
        balanceAfter,
        idempotencyKey: req.idempotencyKey,
        reason: req.reason,
        periodStart: a.periodStart,
      });
      log.info("credit charge", { userId: req.userId, runId: req.runId, toolCallId: req.toolCallId, kind: req.kind, amount: req.amount, balanceAfter });
      return { charged: true, alreadyApplied: false, entry, balance: await this.balance(req.userId) };
    } catch (err) {
      if (err instanceof DuplicateLedgerEntryError) {
        // lost a race with a concurrent identical charge - treat as applied.
        const applied = await this.store.findByIdempotencyKey(req.idempotencyKey);
        return { charged: false, alreadyApplied: true, entry: applied, balance: await this.balance(req.userId) };
      }
      throw err;
    }
  }

  /** A signed (negative) correction. `idempotencyKey` must still be unique. */
  async refund(req: Omit<ChargeRequest, "amount" | "kind"> & { amount: number; kind?: AgentCreditEntryKind }): Promise<ChargeResult> {
    if (req.amount <= 0) throw new Error("refund amount must be > 0");
    const existing = await this.store.findByIdempotencyKey(req.idempotencyKey);
    if (existing) {
      return { charged: false, alreadyApplied: true, entry: existing, balance: await this.balance(req.userId) };
    }
    const a = await this.allowances.resolve(req.userId);
    const consumed = await this.store.sumForPeriod(req.userId, a.periodStart);
    const balanceAfter = a.allowance - consumed + req.amount;
    const entry = await this.store.insert({
      userId: req.userId,
      runId: req.runId,
      stepId: req.stepId ?? null,
      toolCallId: req.toolCallId ?? null,
      kind: req.kind ?? "refund",
      amount: -req.amount,
      balanceAfter,
      idempotencyKey: req.idempotencyKey,
      reason: req.reason,
      periodStart: a.periodStart,
    });
    log.info("credit refund", { userId: req.userId, runId: req.runId, amount: req.amount });
    return { charged: true, alreadyApplied: false, entry, balance: await this.balance(req.userId) };
  }

  /** Full per-run audit: every charge/refund, correlated to tool calls. */
  async historyForRun(runId: string): Promise<StoredLedgerEntry[]> {
    return this.store.entriesForRun(runId);
  }
}

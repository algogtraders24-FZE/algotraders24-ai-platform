// services/agent-framework/credits/index.ts
// AT24 Agent Framework - A9 credit ledger. Server-only.

export { CreditLedger, InsufficientCreditsError } from "./credit-ledger";
export type { CreditBalance, ChargeRequest, ChargeResult } from "./credit-ledger";
export type { CreditStore, StoredLedgerEntry, NewLedgerEntry } from "./credit-store";
export { DuplicateLedgerEntryError } from "./credit-store";
export { InMemoryCreditStore } from "./in-memory-credit-store";
export { PrismaCreditStore } from "./prisma-credit-store";
export {
  type AllowanceResolver,
  type PeriodAllowance,
  PlanAllowanceResolver,
  FixedAllowanceResolver,
} from "./allowance-resolver";

import { CreditLedger } from "./credit-ledger";
import { PrismaCreditStore } from "./prisma-credit-store";
import { PlanAllowanceResolver } from "./allowance-resolver";
import { InMemoryCreditStore } from "./in-memory-credit-store";
import { FixedAllowanceResolver } from "./allowance-resolver";

/** Production ledger: Prisma-backed store + plan-based allowance. INERT until
 *  the A9 migration is applied.
 *
 *  Escape hatch: a validation harness that exercises the runtime but must not
 *  write real ledger rows (and runs before the migration is applied) sets
 *  AGENT_CREDIT_INMEMORY=1 to get a dependency-free ledger instead. Never set
 *  in production. */
export function createCreditLedger(): CreditLedger {
  if (process.env.AGENT_CREDIT_INMEMORY === "1") return inMemoryCreditLedger();
  return new CreditLedger({ store: new PrismaCreditStore(), allowances: new PlanAllowanceResolver() });
}

/** A dependency-free ledger for tests / runtime-exercising validation. */
export function inMemoryCreditLedger(allowance = 1_000_000): CreditLedger {
  return new CreditLedger({ store: new InMemoryCreditStore(), allowances: new FixedAllowanceResolver(allowance) });
}

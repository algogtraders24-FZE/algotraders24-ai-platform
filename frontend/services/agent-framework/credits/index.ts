// services/agent-framework/credits/index.ts
// AT24 Agent Framework - A9 credit ledger. Server-only.

export { CreditLedger, InsufficientCreditsError } from "./credit-ledger";
export type { CreditBalance, ChargeRequest, ChargeResult, CreditThresholdNotifier } from "./credit-ledger";
export { EmailThresholdNotifier } from "./threshold-notifier";
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
import { EmailThresholdNotifier } from "./threshold-notifier";

/** Production ledger: Prisma-backed store + plan-based allowance + the real
 *  credits-low/exhausted email notifier. The A9 migration
 *  (20260907120000_add_agent_credit_ledger) has been applied since
 *  2026-09-07 - this has been live, charging real agent runs, the whole
 *  time (confirmed via the email-communication audit, 2026-09-24 - an
 *  earlier comment here claiming this stays "INERT" was stale).
 *
 *  Escape hatch: a validation harness that exercises the runtime but must
 *  not write real ledger rows sets AGENT_CREDIT_INMEMORY=1 to get a
 *  dependency-free ledger instead (also skips the real notifier - never
 *  set in production). */
export function createCreditLedger(): CreditLedger {
  if (process.env.AGENT_CREDIT_INMEMORY === "1") return inMemoryCreditLedger();
  return new CreditLedger({ store: new PrismaCreditStore(), allowances: new PlanAllowanceResolver(), notifier: new EmailThresholdNotifier() });
}

/** A dependency-free ledger for tests / runtime-exercising validation. */
export function inMemoryCreditLedger(allowance = 1_000_000): CreditLedger {
  return new CreditLedger({ store: new InMemoryCreditStore(), allowances: new FixedAllowanceResolver(allowance) });
}

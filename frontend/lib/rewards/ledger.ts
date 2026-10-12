// lib/rewards/ledger.ts
// (Pure - no I/O.) Balance buckets, the reserve view, and idempotency keys.
import { HOLD_DAYS } from "./config";
import { addDays } from "./money";

/** One money item a user may hold: a released rebate instalment or an earned referral commission. */
export interface BalanceItem {
  amountCents: number;
  /** SCHEDULED (not yet due) | FROZEN | RELEASED | CANCELLED | REVERSED | PAID */
  status: string;
  releasedAt: Date | null;
  payoutId: string | null;
}

export interface Balances {
  scheduled: number; // contractually due later
  frozen: number; // due, but the user is not eligible right now - kept, not forfeited
  holding: number; // released, still inside the hold period
  available: number; // withdrawable now
  requested: number; // reserved by an open payout request
  paid: number;
  reversed: number; // cancelled / reversed (not owed)
}

export function bucketOf(i: BalanceItem, now: Date = new Date()): keyof Balances {
  if (i.status === "CANCELLED" || i.status === "REVERSED") return "reversed";
  if (i.status === "PAID") return "paid";
  if (i.status === "SCHEDULED") return "scheduled";
  if (i.status === "FROZEN") return "frozen";
  // RELEASED
  if (i.payoutId) return "requested";
  if (!i.releasedAt) return "holding";
  return addDays(i.releasedAt, HOLD_DAYS).getTime() <= now.getTime() ? "available" : "holding";
}

export function summarizeBalances(items: BalanceItem[], now: Date = new Date()): Balances {
  const s: Balances = { scheduled: 0, frozen: 0, holding: 0, available: 0, requested: 0, paid: 0, reversed: 0 };
  for (const i of items) s[bucketOf(i, now)] += i.amountCents;
  return s;
}

export interface ReserveSummary {
  reserved: number; // set aside across all contracts
  released: number; // moved out of the reserve to users (instalments released)
  returned: number; // handed back to operations after a cancelled/ended contract
  outstanding: number; // reserved - released - returned = what the company must still be able to pay
}

export interface ReserveRow {
  type: "RESERVED" | "RELEASED" | "RETURNED";
  amountCents: number;
}

export function summarizeReserve(rows: ReserveRow[]): ReserveSummary {
  let reserved = 0, released = 0, returned = 0;
  for (const r of rows) {
    if (r.type === "RESERVED") reserved += r.amountCents;
    else if (r.type === "RELEASED") released += r.amountCents;
    else returned += r.amountCents;
  }
  return { reserved, released, returned, outstanding: reserved - released - returned };
}

/** Admin alert condition: money set aside is less than what is still owed. */
export function reserveShortfall(outstandingLiabilityCents: number, reserveHeldCents: number): number {
  return Math.max(0, outstandingLiabilityCents - reserveHeldCents);
}

/** Deterministic keys so a retried webhook or cron can never write the same money movement twice. */
export const ledgerKey = {
  reserve: (contractId: string) => `reserve:${contractId}`,
  release: (contractId: string, seq: number) => `release:${contractId}:${seq}`,
  commission: (purchaseId: string, level: number) => `commission:${purchaseId}:${level}`,
  payout: (payoutId: string) => `payout:${payoutId}`,
};

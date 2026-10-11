// lib/rewards/money.ts
// (Pure - no I/O.) The contract money maths. Everything is integer cents so a schedule always adds up exactly.
import { multiLevelReferralEnabled, type RewardProductConfig } from "./config";

/** Basis points of an amount, rounded to the nearest cent (helper for display and checks). */
export function bps(amountCents: number, rateBps: number): number {
  return Math.round((amountCents * rateBps) / 10_000);
}

export function formatUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

/** Same calendar day N months later (clamped to the end of a shorter month). */
export function addMonths(d: Date, months: number): Date {
  const out = new Date(d.getTime());
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + months);
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, last));
  return out;
}

export interface InstallmentPlan {
  seq: number;
  dueAt: Date;
  amountCents: number;
}

export interface ContractMoney {
  listPriceCents: number;
  rebateTotalCents: number;
  /** What the buyer effectively pays: list price minus the whole rebate. Shown everywhere next to the list price. */
  netPriceCents: number;
  /** Set aside on the day the payment is verified. Equals the whole rebate. */
  reserveCents: number;
  schedule: InstallmentPlan[];
  startsAt: Date;
  endsAt: Date;
}

/** Throws on a configuration that would be unsafe (rebate must be below the price, instalments positive). */
export function assertProductSane(p: RewardProductConfig): void {
  if (!Number.isInteger(p.listPriceCents) || p.listPriceCents <= 0) throw new Error(`${p.key}: bad list price`);
  if (!Number.isInteger(p.rebateCents) || p.rebateCents < 0 || p.rebateCents >= p.listPriceCents) throw new Error(`${p.key}: rebate must be below the price`);
  if (p.referralCents.some((c) => !Number.isInteger(c) || c < 0)) throw new Error(`${p.key}: bad referral amount`);
  if (p.rebateCents + p.referralCents.reduce((a, b) => a + b, 0) >= p.listPriceCents) throw new Error(`${p.key}: rebate plus referral must stay below the price`);
  if (!Number.isInteger(p.installments) || p.installments < 1 || p.installments > 12) throw new Error(`${p.key}: bad instalment count`);
  if (!Number.isInteger(p.intervalDays) || p.intervalDays < 1) throw new Error(`${p.key}: bad interval`);
  if (p.installments * p.intervalDays > Math.round(p.termMonths * 30.5) + 5) throw new Error(`${p.key}: instalments do not fit inside the contract term`);
}

/** The full money picture of one contract sold at the product's list price. The remainder cent goes to the LAST instalment. */
export function computeContractMoney(p: RewardProductConfig, purchasedAt: Date): ContractMoney {
  assertProductSane(p);
  const rebateTotalCents = p.rebateCents;
  const base = Math.floor(rebateTotalCents / p.installments);
  const schedule: InstallmentPlan[] = [];
  let allocated = 0;
  for (let i = 1; i <= p.installments; i++) {
    const amountCents = i === p.installments ? rebateTotalCents - allocated : base;
    allocated += amountCents;
    schedule.push({ seq: i, dueAt: addDays(purchasedAt, p.intervalDays * i), amountCents });
  }
  return {
    listPriceCents: p.listPriceCents,
    rebateTotalCents,
    netPriceCents: p.listPriceCents - rebateTotalCents,
    reserveCents: rebateTotalCents,
    schedule,
    startsAt: purchasedAt,
    endsAt: addMonths(purchasedAt, p.termMonths),
  };
}

export interface ReferralShare {
  /** 0 = the direct seller, 1-3 = the upline levels. */
  level: number;
  partnerId: string;
  amountCents: number;
}

/**
 * Commission for one verified, collected sale. `upline` is [direct seller, level1, level2, level3] user ids (shorter or with
 * gaps is fine). Only the direct level is paid unless multi-level is explicitly enabled. A partner who is the buyer is skipped
 * (self-referral), and a user is never paid twice on the same sale.
 */
export function computeReferralShares(
  p: RewardProductConfig,
  buyerId: string,
  upline: Array<string | null | undefined>,
  multiLevel: boolean = multiLevelReferralEnabled(),
): ReferralShare[] {
  const maxLevels = multiLevel ? p.referralCents.length : 1;
  const seen = new Set<string>([buyerId]);
  const out: ReferralShare[] = [];
  for (let level = 0; level < maxLevels; level++) {
    const partnerId = upline[level];
    if (!partnerId || seen.has(partnerId)) continue;
    seen.add(partnerId);
    const amountCents = p.referralCents[level];
    if (amountCents > 0) out.push({ level, partnerId, amountCents });
  }
  return out;
}

/** Everything that can leave the company for one sale, for the admin margin view. Delivery/support/gateway costs are NOT included (owner input pending). */
export function maxOutflowCents(p: RewardProductConfig, multiLevel: boolean = multiLevelReferralEnabled()): number {
  const levels = multiLevel ? p.referralCents : p.referralCents.slice(0, 1);
  return p.rebateCents + levels.reduce((s, c) => s + c, 0);
}

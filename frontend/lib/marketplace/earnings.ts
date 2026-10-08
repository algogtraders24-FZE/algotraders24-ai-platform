// lib/marketplace/earnings.ts
// (Pure money policy - no I/O, safe for the browser and for scripts/validate-seller-earnings.ts.)
// Seller self-serve Phase 4. Owner-approved defaults (2026-10-09): 10% platform commission, estimated payment-gateway fee
// borne by the seller, 7-day hold before money is available, payouts in USDT on request, minimum payout 50 USD,
// no seller KYC for now. Products sold by the platform owner carry 0% and no ledger row at all.

export const COMMISSION_RATE = 0.1;
export const HOLD_DAYS = 7;
export const MIN_PAYOUT_USD = 50;
/** Estimated crypto-gateway fee as a percent of the sale price, fixed on each sale. Override with MARKETPLACE_GATEWAY_FEE_PCT. */
export const DEFAULT_GATEWAY_FEE_PCT = 0.5;

export type PayoutNetwork = "TRC20" | "ERC20" | "BEP20";
export const PAYOUT_NETWORKS: PayoutNetwork[] = ["TRC20", "ERC20", "BEP20"];

/** Round to cents. */
export const cents = (n: number): number => Math.round(n * 100) / 100;

export interface SaleSplit {
  grossAmount: number;
  commissionRate: number;
  commissionAmount: number;
  gatewayFee: number;
  netAmount: number;
}

export function gatewayFeePct(raw: string | undefined | null = process.env.MARKETPLACE_GATEWAY_FEE_PCT): number {
  const v = raw === undefined || raw === null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(v) && v >= 0 && v <= 10 ? v : DEFAULT_GATEWAY_FEE_PCT;
}

/** Split one sale. The platform share is rounded first, then the gateway fee; the seller's net is what is left (never negative). */
export function computeSaleSplit(grossAmount: number, opts: { commissionRate?: number; gatewayPct?: number } = {}): SaleSplit {
  const gross = cents(Math.max(0, grossAmount));
  const commissionRate = opts.commissionRate ?? COMMISSION_RATE;
  const commissionAmount = cents(gross * commissionRate);
  const gatewayFee = cents((gross * (opts.gatewayPct ?? gatewayFeePct())) / 100);
  const netAmount = cents(Math.max(0, gross - commissionAmount - gatewayFee));
  return { grossAmount: gross, commissionRate, commissionAmount, gatewayFee, netAmount };
}

export function availableAtFor(purchasedAt: Date): Date {
  return new Date(purchasedAt.getTime() + HOLD_DAYS * 86_400_000);
}

export interface EarningLike {
  netAmount: number;
  status: string; // PENDING | REVERSED | PAID
  payoutId: string | null;
  availableAt: Date;
}

export interface EarningsSummary {
  holding: number; // sold, still inside the hold period
  available: number; // past the hold, not in any payout
  requested: number; // reserved by an open payout request
  paid: number; // already paid out
  reversed: number; // refunded sales (not owed)
}

/** Where one earning stands right now. */
export function earningBucket(e: EarningLike, now: Date = new Date()): keyof EarningsSummary {
  if (e.status === "REVERSED") return "reversed";
  if (e.status === "PAID") return "paid";
  if (e.payoutId) return "requested";
  return e.availableAt.getTime() <= now.getTime() ? "available" : "holding";
}

export function summarizeEarnings(earnings: EarningLike[], now: Date = new Date()): EarningsSummary {
  const s: EarningsSummary = { holding: 0, available: 0, requested: 0, paid: 0, reversed: 0 };
  for (const e of earnings) s[earningBucket(e, now)] += e.netAmount;
  return { holding: cents(s.holding), available: cents(s.available), requested: cents(s.requested), paid: cents(s.paid), reversed: cents(s.reversed) };
}

/** Why a payout of the whole available balance cannot be requested right now (null = fine). */
export function payoutBlocker(available: number): string | null {
  if (available < MIN_PAYOUT_USD) return `The minimum payout is ${MIN_PAYOUT_USD} USD; you have ${available.toFixed(2)} USD available.`;
  return null;
}

const TRC20_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const EVM_RE = /^0x[0-9a-fA-F]{40}$/;

/** Format check only (we cannot know the address is the seller's). Returns an error message or null. */
export function validatePayoutAddress(network: string, address: string): string | null {
  const a = address.trim();
  if (!PAYOUT_NETWORKS.includes(network as PayoutNetwork)) return "Choose TRC20, ERC20 or BEP20.";
  if (network === "TRC20") return TRC20_RE.test(a) ? null : "That does not look like a TRC20 (Tron) address - it starts with T and has 34 characters.";
  return EVM_RE.test(a) ? null : `That does not look like a ${network} address - it starts with 0x and has 42 characters.`;
}

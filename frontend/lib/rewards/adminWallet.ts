// lib/rewards/adminWallet.ts
// (Pure - no I/O.) The admin Wallet page maths: money in (payments received), money out (withdrawals), referral commissions and rebate
// credits, bucketed per calendar day in India time (IST, UTC+5:30 - the owner's day). Integer cents everywhere.

export const IST_OFFSET_MS = 330 * 60_000;

/** "YYYY-MM-DD" of an instant in IST. */
export function istDay(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Start (UTC instant) of an IST calendar day. */
export function istDayStart(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - IST_OFFSET_MS);
}

/** The last `count` IST days ending today, oldest first. */
export function lastDays(count: number, now: Date = new Date()): string[] {
  const today = istDayStart(istDay(now)).getTime();
  return Array.from({ length: count }, (_, i) => istDay(new Date(today + 12 * 3_600_000 - (count - 1 - i) * 86_400_000)));
}

export interface WalletInput {
  /** Payments received: completed purchases with an amount above zero (at = payment time). */
  deposits: Array<{ at: Date; amountCents: number }>;
  /** Refunded / reversed purchases (at = when it changed). */
  refunds: Array<{ at: Date; amountCents: number }>;
  /** Withdrawal requests (members and marketplace sellers): requested at, paid at (null until paid). */
  withdrawals: Array<{ requestedAt: Date; paidAt: Date | null; amountCents: number }>;
  /** Referral commissions that count (not cancelled / reversed), at = created. */
  commissions: Array<{ at: Date; amountCents: number }>;
  /** Rebate instalments released to members. */
  rebates: Array<{ at: Date; amountCents: number }>;
}

export interface DailyRow {
  day: string;
  depositsCents: number; depositCount: number;
  refundsCents: number; refundCount: number;
  withdrawalsRequestedCents: number; withdrawalsRequestedCount: number;
  withdrawalsPaidCents: number; withdrawalsPaidCount: number;
  commissionsCents: number; commissionCount: number;
  rebatesCents: number; rebateCount: number;
  /** Money in minus money paid out that day (deposits - refunds - withdrawals paid). */
  netCents: number;
}

type Totals = Omit<DailyRow, "day">;

function emptyTotals(): Totals {
  return {
    depositsCents: 0, depositCount: 0, refundsCents: 0, refundCount: 0, withdrawalsRequestedCents: 0, withdrawalsRequestedCount: 0,
    withdrawalsPaidCents: 0, withdrawalsPaidCount: 0, commissionsCents: 0, commissionCount: 0, rebatesCents: 0, rebateCount: 0, netCents: 0,
  };
}

export function buildDaily(days: string[], input: WalletInput): DailyRow[] {
  const rows = new Map<string, DailyRow>(days.map((day) => [day, { day, ...emptyTotals() }]));
  const add = (at: Date, fn: (r: DailyRow) => void) => { const r = rows.get(istDay(at)); if (r) fn(r); };
  for (const x of input.deposits) add(x.at, (r) => { r.depositsCents += x.amountCents; r.depositCount++; });
  for (const x of input.refunds) add(x.at, (r) => { r.refundsCents += x.amountCents; r.refundCount++; });
  for (const w of input.withdrawals) {
    add(w.requestedAt, (r) => { r.withdrawalsRequestedCents += w.amountCents; r.withdrawalsRequestedCount++; });
    if (w.paidAt) add(w.paidAt, (r) => { r.withdrawalsPaidCents += w.amountCents; r.withdrawalsPaidCount++; });
  }
  for (const x of input.commissions) add(x.at, (r) => { r.commissionsCents += x.amountCents; r.commissionCount++; });
  for (const x of input.rebates) add(x.at, (r) => { r.rebatesCents += x.amountCents; r.rebateCount++; });
  for (const r of rows.values()) r.netCents = r.depositsCents - r.refundsCents - r.withdrawalsPaidCents;
  return days.map((d) => rows.get(d) as DailyRow);
}

export function sumDaily(rows: DailyRow[]): Totals {
  const t = emptyTotals();
  for (const r of rows) for (const k of Object.keys(t) as Array<keyof Totals>) t[k] += r[k];
  return t;
}

/** Cents from a dollar Float (purchases and seller payouts store dollars). */
export function dollarsToCents(v: number): number {
  return Math.round(v * 100);
}

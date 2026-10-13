// lib/rewards/wallet.ts
// (Pure - no I/O.) The wallet view: one list of everything that moved in a member's balance, with WHERE each amount came from, and the
// totals by source. The server loads the rows; this file turns them into entries and sums, so the wording and the maths are testable.
// Privacy: other people are only ever shown masked ("R*** K.") - never an email address.

export type CommissionSource = "CONTRACT" | "PRODUCT" | "SUBSCRIPTION";

/** "Ravi Kumar" -> "R*** K."; a single name -> "R***"; no name -> the first letter of the email name + "***". Never returns an email. */
export function maskName(name: string | null | undefined, email?: string | null): string {
  const clean = (name ?? "").trim().replace(/\s+/g, " ");
  const base = clean || (email ?? "").split("@")[0].trim();
  if (!base) return "A member";
  const parts = base.split(" ");
  const first = `${Array.from(parts[0])[0].toUpperCase()}***`;
  if (parts.length === 1) return first;
  return `${first} ${Array.from(parts[parts.length - 1])[0].toUpperCase()}.`;
}

export function levelLabel(level: number): string {
  return level === 0 ? "direct" : `level ${level + 1}`;
}

export function sourceLabel(source: CommissionSource, detail?: string | null): string {
  if (source === "CONTRACT") return detail ? `Algo Contract (${detail})` : "Algo Contract";
  if (source === "SUBSCRIPTION") return "Pro plan payment";
  return detail ? `Product: ${detail}` : "Product purchase";
}

/** Old commission rows have no stored source: a "sub:" reference is a Pro payment; otherwise it is a contract if one hangs off that purchase. */
export function inferSource(purchaseRef: string, stored: string | null | undefined, hasContract: boolean): CommissionSource {
  if (stored === "CONTRACT" || stored === "PRODUCT" || stored === "SUBSCRIPTION") return stored;
  if (purchaseRef.startsWith("sub:")) return "SUBSCRIPTION";
  return hasContract ? "CONTRACT" : "PRODUCT";
}

export type EntryKind = "REBATE" | "REFERRAL" | "WITHDRAWAL";

export interface WalletEntry {
  id: string;
  at: Date;
  kind: EntryKind;
  title: string;
  detail: string;
  /** Positive = money in, negative = money out (a withdrawal). */
  amountCents: number;
  statusLabel: string;
  /** Counted in the totals (not cancelled or reversed). */
  counts: boolean;
  /** Referral rows only. */
  level?: number;
  source?: CommissionSource;
}

const REBATE_STATUS: Record<string, string> = { SCHEDULED: "Coming", FROZEN: "Paused, kept for you", RELEASED: "Released", PAID: "Paid out", CANCELLED: "Cancelled" };
const COMMISSION_STATUS: Record<string, string> = { PENDING: "On hold", RELEASED: "Released", PAID: "Paid out", CANCELLED: "Cancelled", REVERSED: "Reversed" };
const PAYOUT_STATUS: Record<string, string> = { REQUESTED: "Waiting to be paid", PAID: "Paid", REJECTED: "Declined" };

export interface RebateRow { id: string; contractId: string; seq: number; dueAt: Date; releasedAt: Date | null; amountCents: number; status: string }
export interface CommissionRow { id: string; purchaseRef: string; level: number; amountCents: number; status: string; createdAt: Date; availableAt: Date; releasedAt: Date | null; source: CommissionSource; detail: string | null; buyerName: string | null }
export interface PayoutRow { id: string; amountCents: number; network: string; status: string; txRef: string | null; createdAt: Date }

export function buildWalletEntries(input: {
  rebates: RebateRow[];
  contractNames: Record<string, string>;
  installmentsPerContract: Record<string, number>;
  commissions: CommissionRow[];
  payouts: PayoutRow[];
}): WalletEntry[] {
  const out: WalletEntry[] = [];
  for (const r of input.rebates) {
    const total = input.installmentsPerContract[r.contractId];
    out.push({
      id: `rebate:${r.id}`,
      at: r.releasedAt ?? r.dueAt,
      kind: "REBATE",
      title: "Contract rebate",
      detail: `${input.contractNames[r.contractId] ?? "Algo Contract"} - instalment ${r.seq}${total ? ` of ${total}` : ""}`,
      amountCents: r.amountCents,
      statusLabel: REBATE_STATUS[r.status] ?? r.status,
      counts: r.status !== "CANCELLED",
    });
  }
  for (const c of input.commissions) {
    out.push({
      id: `commission:${c.id}`,
      at: c.releasedAt ?? c.createdAt,
      kind: "REFERRAL",
      title: `Referral commission (${levelLabel(c.level)})`,
      detail: `${sourceLabel(c.source, c.detail)}${c.buyerName ? ` - ${c.buyerName}` : ""}`,
      amountCents: c.amountCents,
      statusLabel: COMMISSION_STATUS[c.status] ?? c.status,
      counts: c.status !== "CANCELLED" && c.status !== "REVERSED",
      level: c.level,
      source: c.source,
    });
  }
  for (const p of input.payouts) {
    out.push({
      id: `payout:${p.id}`,
      at: p.createdAt,
      kind: "WITHDRAWAL",
      title: `Withdrawal (${p.network})`,
      detail: p.txRef ? `Transaction ${p.txRef}` : "USDT",
      amountCents: -p.amountCents,
      statusLabel: PAYOUT_STATUS[p.status] ?? p.status,
      counts: p.status !== "REJECTED",
    });
  }
  return out.sort((a, b) => b.at.getTime() - a.at.getTime());
}

export interface SourceTotals {
  rebates: number;
  referralDirect: number;
  referralTeam: number;
  byType: { contracts: number; products: number; subscriptions: number };
  withdrawn: number;
}

/** Totals by where the money came from. Cancelled / reversed rows and declined withdrawals are left out; a withdrawal counts as taken out. */
export function summarizeBySource(entries: WalletEntry[]): SourceTotals {
  const t: SourceTotals = { rebates: 0, referralDirect: 0, referralTeam: 0, byType: { contracts: 0, products: 0, subscriptions: 0 }, withdrawn: 0 };
  for (const e of entries) {
    if (!e.counts) continue;
    if (e.kind === "REBATE") t.rebates += e.amountCents;
    else if (e.kind === "WITHDRAWAL") t.withdrawn += -e.amountCents;
    else {
      if ((e.level ?? 0) === 0) t.referralDirect += e.amountCents;
      else t.referralTeam += e.amountCents;
      if (e.source === "CONTRACT") t.byType.contracts += e.amountCents;
      else if (e.source === "SUBSCRIPTION") t.byType.subscriptions += e.amountCents;
      else t.byType.products += e.amountCents;
    }
  }
  return t;
}

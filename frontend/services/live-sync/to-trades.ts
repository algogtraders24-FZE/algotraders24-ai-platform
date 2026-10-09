// services/live-sync/to-trades.ts
// Turns synced deals into the Edge Analyzer's normalized shapes. Pure, no DB.
// A position becomes a ClosedTrade only when its whole volume has been closed
// and its opening deal is part of the synced history; everything else is
// counted and reported, never guessed.

import type { BalanceOp, ClosedTrade } from "../edge-analyzer/types";
import type { DealEntry, DealType } from "./contract";

export interface SyncedDeal {
  positionId: string;
  /** Broker server time, epoch ms (treated as naive time, same as report files). */
  timeMsc: number;
  symbol: string;
  type: DealType | string;
  entry: DealEntry | string;
  volume: number;
  price: number;
  commission: number;
  swap: number;
  profit: number;
  fee: number;
  comment: string;
}

export interface MappedHistory {
  trades: ClosedTrade[];
  balanceOps: BalanceOp[];
  /** Positions skipped because their opening deal is not in the synced history. */
  missingOpen: number;
  /** Positions still (partly) open: not closed trades yet. */
  stillOpen: number;
}

const EPS = 1e-6;

export type MarginKind = "hedging" | "netting";

/** Hedging accounts pair deals by position id; netting accounts keep ONE position per symbol, so they are built from a per-symbol ledger. */
export function dealsToHistory(deals: readonly SyncedDeal[], marginMode: MarginKind | string = "hedging"): MappedHistory {
  if (marginMode === "netting") return netDealsToHistory(deals);
  return hedgingDealsToHistory(deals);
}

function splitBalanceOps(deals: readonly SyncedDeal[]): { balanceOps: BalanceOp[]; tradeDeals: SyncedDeal[] } {
  const balanceOps: BalanceOp[] = [];
  const tradeDeals: SyncedDeal[] = [];
  for (const d of deals) {
    if (d.type === "balance") balanceOps.push({ time: d.timeMsc, amount: d.profit });
    else if (d.type === "buy" || d.type === "sell") tradeDeals.push(d);
  }
  balanceOps.sort((a, b) => a.time - b.time);
  return { balanceOps, tradeDeals };
}

interface NetState {
  dir: "buy" | "sell";
  /** Signed open volume: buys positive, sells negative. */
  net: number;
  openTime: number;
  inVol: number;
  inCost: number;
  profit: number;
  commission: number;
  swap: number;
  tag: string;
}

/**
 * Netting accounts: all deals of one symbol form ONE position that is added to, reduced and possibly reversed.
 * A trade starts when the net volume leaves zero and ends when it returns to zero; a deal that overshoots zero
 * (a reversal, entry "inout") closes the trade and its remainder opens the next one in the other direction.
 * The deal's profit is realised on the part that closes, its commission and swap are split by volume.
 * Position ids are not used at all, so this does not depend on how a broker numbers a reversal.
 */
export function netDealsToHistory(deals: readonly SyncedDeal[]): MappedHistory {
  const { balanceOps, tradeDeals } = splitBalanceOps(deals);
  const ordered = tradeDeals.map((d, i) => ({ d, i })).sort((a, b) => a.d.timeMsc - b.d.timeMsc || a.i - b.i).map((x) => x.d);
  const states = new Map<string, NetState>();
  const trades: ClosedTrade[] = [];
  let missingOpen = 0;

  const open = (d: SyncedDeal, volume: number, share: number): NetState => ({
    dir: d.type === "buy" ? "buy" : "sell",
    net: (d.type === "buy" ? 1 : -1) * volume,
    openTime: d.timeMsc,
    inVol: volume,
    inCost: volume * d.price,
    profit: 0,
    commission: (d.commission + d.fee) * share,
    swap: d.swap * share,
    tag: d.comment || "",
  });

  for (const d of ordered) {
    const v = d.volume;
    if (!(v > EPS)) continue;
    const s = d.type === "buy" ? 1 : -1;
    const st = states.get(d.symbol);
    if (!st) {
      if (d.entry === "out") {
        missingOpen++; // reduces a position whose opening deal is not in the synced history
        continue;
      }
      states.set(d.symbol, open(d, v, 1));
      continue;
    }
    if (Math.sign(st.net) === s) {
      st.net += s * v;
      st.inVol += v;
      st.inCost += v * d.price;
      st.profit += d.profit;
      st.commission += d.commission + d.fee;
      st.swap += d.swap;
      if (!st.tag) st.tag = d.comment || "";
      continue;
    }
    const closeVol = Math.min(v, Math.abs(st.net));
    const share = closeVol / v;
    st.profit += d.profit;
    st.commission += (d.commission + d.fee) * share;
    st.swap += d.swap * share;
    st.net += s * closeVol;
    if (Math.abs(st.net) <= EPS) {
      const profit = st.profit;
      trades.push({
        positionId: `${d.symbol}@${st.openTime}`,
        symbol: d.symbol,
        direction: st.dir,
        volume: st.inVol,
        openTime: st.openTime,
        closeTime: d.timeMsc,
        openPrice: st.inCost / st.inVol,
        closePrice: d.price,
        stopLoss: null,
        takeProfit: null,
        commission: st.commission,
        swap: st.swap,
        profit,
        net: profit + st.commission + st.swap,
        tag: st.tag,
      });
      states.delete(d.symbol);
      const rest = v - closeVol;
      if (rest > EPS) states.set(d.symbol, open(d, rest, 1 - share));
    }
  }
  trades.sort((a, b) => a.closeTime - b.closeTime);
  return { trades, balanceOps, missingOpen, stillOpen: states.size };
}

function hedgingDealsToHistory(deals: readonly SyncedDeal[]): MappedHistory {
  const balanceOps: BalanceOp[] = [];
  const byPosition = new Map<string, SyncedDeal[]>();
  for (const d of deals) {
    if (d.type === "balance") {
      balanceOps.push({ time: d.timeMsc, amount: d.profit });
      continue;
    }
    if (d.type !== "buy" && d.type !== "sell") continue;
    const list = byPosition.get(d.positionId);
    if (list) list.push(d);
    else byPosition.set(d.positionId, [d]);
  }
  balanceOps.sort((a, b) => a.time - b.time);

  const trades: ClosedTrade[] = [];
  let missingOpen = 0;
  let stillOpen = 0;
  for (const [positionId, list] of byPosition) {
    list.sort((a, b) => a.timeMsc - b.timeMsc);
    const opens = list.filter((d) => d.entry === "in");
    const closes = list.filter((d) => d.entry === "out" || d.entry === "inout");
    if (opens.length === 0) {
      if (closes.length > 0) missingOpen++;
      continue;
    }
    if (closes.length === 0) {
      stillOpen++;
      continue;
    }
    const inVol = opens.reduce((s, d) => s + d.volume, 0);
    const outVol = closes.reduce((s, d) => s + d.volume, 0);
    if (outVol + EPS < inVol) {
      stillOpen++;
      continue;
    }
    const first = opens[0];
    const last = closes[closes.length - 1];
    const profit = list.reduce((s, d) => s + d.profit, 0);
    const commission = list.reduce((s, d) => s + d.commission + d.fee, 0);
    const swap = list.reduce((s, d) => s + d.swap, 0);
    const wavg = opens.reduce((s, d) => s + d.price * d.volume, 0) / inVol;
    trades.push({
      positionId,
      symbol: first.symbol,
      direction: first.type === "buy" ? "buy" : "sell",
      volume: inVol,
      openTime: first.timeMsc,
      closeTime: last.timeMsc,
      openPrice: wavg,
      closePrice: last.price,
      stopLoss: null,
      takeProfit: null,
      commission,
      swap,
      profit,
      net: profit + commission + swap,
      tag: first.comment || last.comment || "",
    });
  }
  trades.sort((a, b) => a.closeTime - b.closeTime);
  return { trades, balanceOps, missingOpen, stillOpen };
}

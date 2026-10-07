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

export function dealsToHistory(deals: readonly SyncedDeal[]): MappedHistory {
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

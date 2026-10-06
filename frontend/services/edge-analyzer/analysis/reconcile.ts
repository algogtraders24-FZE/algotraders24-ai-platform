// services/edge-analyzer/analysis/reconcile.ts
// AT24 Trader Edge Analyzer (E1) - cross-check OUR numbers against the figures
// the terminal itself printed in the report. A pass is strong evidence the
// parser read every column correctly; a fail is surfaced to the user, never hidden.

import type { ClosedTrade, ReconciliationCheck, ReportedResults } from "../types";
import type { CoreStats } from "./core";

const TOL = 0.011; // currency rounding

function check(name: string, reported: number | null, computed: number, tol = TOL): ReconciliationCheck | null {
  if (reported === null) return null;
  return { check: name, reported, computed, ok: Math.abs(reported - computed) <= tol };
}

export function reconcile(trades: readonly ClosedTrade[], core: CoreStats, reported: ReportedResults | null): ReconciliationCheck[] {
  if (!reported) return [];
  const long = trades.filter((t) => t.direction === "buy").length;
  const short = trades.length - long;
  // MT5 counts a trade with profit >= 0 as a "profit trade".
  const mt5ProfitTrades = core.wins + core.breakeven;
  const checks = [
    check("Total net profit", reported.totalNetProfit, core.netProfit),
    check("Gross profit", reported.grossProfit, core.grossProfit),
    check("Gross loss", reported.grossLoss, core.grossLoss),
    check("Total trades", reported.totalTrades, core.tradeCount, 0),
    check("Long trades", reported.longTrades, long, 0),
    check("Short trades", reported.shortTrades, short, 0),
    check("Profit trades", reported.profitTrades, mt5ProfitTrades, 0),
    check("Loss trades", reported.lossTrades, core.losses, 0),
    check("Max balance drawdown", reported.balanceDrawdownMaximal, core.maxDrawdownAbs),
    check("Max balance drawdown %", reported.balanceDrawdownMaximalPct, core.maxDrawdownPct),
    check("Absolute balance drawdown", reported.balanceDrawdownAbsolute, core.absoluteDrawdown),
  ];
  return checks.filter((c): c is ReconciliationCheck => c !== null);
}

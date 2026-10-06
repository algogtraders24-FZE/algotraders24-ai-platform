// services/edge-analyzer/types.ts
// AT24 Trader Edge Analyzer (E1) - normalized, platform-neutral shapes.
// docs/TRADER-EDGE-ANALYZER-SPEC.md. No PII lives here by design: account
// number, holder name, company and server are never extracted.

/** One CLOSED position, normalized. Times are BROKER SERVER time read as if
 *  UTC (epoch ms of the naive timestamp) - never real UTC. */
export interface ClosedTrade {
  positionId: string;
  symbol: string;
  direction: "buy" | "sell";
  volume: number;
  openTime: number;
  closeTime: number;
  openPrice: number;
  closePrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  commission: number;
  swap: number;
  /** Raw platform "Profit" column. */
  profit: number;
  /** profit + commission + swap - what the account actually gained/lost. */
  net: number;
  /** The platform comment (often an EA/strategy tag). May be empty. */
  tag: string;
}

/** Balance operation (deposit/withdrawal/adjustment), not a trade. */
export interface BalanceOp {
  time: number;
  amount: number;
}

export interface ReportMeta {
  platform: "MT5";
  currency: string | null;
  accountMode: "demo" | "real" | "contest" | null;
  hedging: boolean | null;
  /** Broker-time epoch of the report date, or null. */
  reportDate: number | null;
  /** First balance deal (initial deposit), or null if not present. */
  initialDeposit: number | null;
}

/** Figures the TERMINAL itself printed in the report's Results block. */
export interface ReportedResults {
  totalNetProfit: number | null;
  grossProfit: number | null;
  grossLoss: number | null;
  totalTrades: number | null;
  shortTrades: number | null;
  longTrades: number | null;
  /** MT5 counts profit >= 0 as a "profit trade". */
  profitTrades: number | null;
  lossTrades: number | null;
  balanceDrawdownAbsolute: number | null;
  balanceDrawdownMaximal: number | null;
  balanceDrawdownMaximalPct: number | null;
}

export interface ReconciliationCheck {
  check: string;
  reported: number;
  computed: number;
  ok: boolean;
}

export type ParseErrorCode = "too_large" | "not_mt5_report" | "unsupported_layout" | "no_trades";

export type Mt5ParseResult =
  | {
      ok: true;
      meta: ReportMeta;
      trades: ClosedTrade[];
      balanceOps: BalanceOp[];
      reported: ReportedResults | null;
      warnings: string[];
    }
  | { ok: false; error: ParseErrorCode; message: string };

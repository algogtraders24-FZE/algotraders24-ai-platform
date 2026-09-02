/**
 * Q0.9 - maps run_backtest_job.py's raw, engine-native JSON (snake_case,
 * shaped like engine.summarize()'s own stats dict - see
 * Q0.9_EXISTING_EXECUTION_PATH.md) into the frontend's frozen
 * BacktestResult contract (types/quant-lite.ts, Q0.7/Q0.8). This is the
 * ONLY place that translation happens, replacing the ad-hoc one-off
 * mapping quant-engine/scripts/q08_gen_frontend_data.py did by hand for
 * the single sample result.
 *
 * Real capability gained vs. Q0.8: winningTrades/losingTrades/
 * largestWin/largestLoss/averageTrade were hardcoded null in the Q0.8
 * mock because summarize() never computes them - now that a real trade
 * ledger is available, they are computed here for real, directly from
 * that ledger. Not fabrication: every one of these is a plain aggregate
 * over real trade rows, the same way profit factor is unavailable only
 * when profit_factor is null upstream. Fields the ledger genuinely
 * cannot support (sharpe, per-trade SL/TP price, slPrice/tpPrice) stay
 * null.
 */
import type { BacktestMetrics, BacktestResult, ExecutionAssumptions, ExitReason, ResultProvenance, Trade } from "@/types/quant-lite";
import type { CoverageAssessment } from "@/types/quant-lite-coverage";

interface RawTrade {
  tradeNumber: number;
  direction: number;
  entryTime: string;
  entryPrice: number;
  exitTime: string;
  exitPrice: number;
  volume: number;
  pnl: number;
  reason: string;
  balanceAfter: number;
}

interface RawStats {
  trades_total: number;
  trade_cycles?: number;
  win_rate_pct: number | null;
  profit_factor: number | null;
  total_return_pct: number;
  max_drawdown_pct: number;
  final_balance: number;
  same_minute_sl_tp_conflicts?: number;
  account_blown?: boolean;
}

interface RawProvenance {
  jobId: string;
  requestHash: string;
  resultHash: string;
  symbol: string;
  signalTimeframe: string;
  execTimeframe: string;
  dateRange: { start: string; end: string };
  initialCapital: number;
  riskPct: number;
  engineVersion: string;
  signalBarsLoaded: number;
  execBarsLoaded: number;
  generatedAt: string;
}

export interface RawEngineOutput {
  status: "COMPLETED";
  stats: RawStats;
  trades: RawTrade[];
  equityCurve: Array<{ time: string; balance: number }>;
  provenance: RawProvenance;
}

function mapExitReason(reason: string): ExitReason {
  if (reason === "SL" || reason === "TP" || reason === "PARTIAL") return reason;
  return "PARTIAL";
}

function mapTrades(raw: RawTrade[]): Trade[] {
  return raw.map((t) => ({
    tradeNumber: t.tradeNumber,
    direction: t.direction > 0 ? "BUY" : "SELL",
    entryTime: t.entryTime,
    entryPrice: t.entryPrice,
    exitTime: t.exitTime,
    exitPrice: t.exitPrice,
    exitReason: mapExitReason(t.reason),
    pnl: t.pnl,
    balanceAfter: t.balanceAfter,
    // The engine does not record the SL/TP price level actually in force
    // at exit time (it can move via breakeven/trailing when those are
    // on - irrelevant for Quant Lite since both are always off, but the
    // field genuinely isn't in the trade dict either way) - Q0.7 Part 6
    // gap, still null, not fabricated from entryPrice +/- a guessed distance.
    slPrice: null,
    tpPrice: null,
  }));
}

function computeMetrics(stats: RawStats, trades: Trade[]): BacktestMetrics {
  const closed = trades.filter((t) => t.exitReason === "SL" || t.exitReason === "TP");
  const wins = closed.filter((t) => t.pnl > 0);
  const losses = closed.filter((t) => t.pnl <= 0);

  return {
    tradesTotal: stats.trades_total,
    winRatePct: stats.win_rate_pct,
    profitFactor: stats.profit_factor,
    totalReturnPct: stats.total_return_pct,
    maxDrawdownPct: stats.max_drawdown_pct,
    finalBalance: stats.final_balance,
    accountBlown: stats.account_blown ?? false,
    winningTrades: closed.length ? wins.length : null,
    losingTrades: closed.length ? losses.length : null,
    averageTrade: closed.length ? closed.reduce((sum, t) => sum + t.pnl, 0) / closed.length : null,
    largestWin: wins.length ? Math.max(...wins.map((t) => t.pnl)) : null,
    largestLoss: losses.length ? Math.min(...losses.map((t) => t.pnl)) : null,
  };
}

function buildAssumptions(symbol: string): ExecutionAssumptions {
  return {
    executionModel: "Quant Lite Canonical Engine (execution_mtf.py, 1-minute resolution)",
    spread: "Time-varying real market spread (candle_spread.avg_spread)",
    slippage: "Not modeled",
    commission: "Not modeled",
    breakeven: "OFF",
    trailing: "OFF",
    partialClose: "OFF",
    dataSource: `Real Exness tick data (${symbol})`,
  };
}

export function mapEngineOutputToResult(raw: RawEngineOutput, strategyName: string, dataQuality: CoverageAssessment | undefined): BacktestResult {
  const trades = mapTrades(raw.trades);
  const metrics = computeMetrics(raw.stats, trades);
  const provenance: ResultProvenance = {
    symbol: raw.provenance.symbol,
    timeframe: raw.provenance.signalTimeframe,
    dateRange: raw.provenance.dateRange,
    initialCapital: raw.provenance.initialCapital,
    engineVersion: raw.provenance.engineVersion,
    generatedAt: raw.provenance.generatedAt,
    dataQuality,
  };

  // Data-quality messaging is shown once, via CoverageAssessmentPanel
  // (fed by provenance.dataQuality below) - not duplicated into
  // `warnings` too.
  const warnings = raw.stats.same_minute_sl_tp_conflicts
    ? [`${raw.stats.same_minute_sl_tp_conflicts} trade(s) had both SL and TP touched within the same 1-minute bar - resolved pessimistically as SL (see execution assumptions).`]
    : [];

  return {
    backtestId: raw.provenance.jobId,
    status: "completed",
    strategyName,
    metrics,
    trades,
    assumptions: buildAssumptions(raw.provenance.symbol),
    warnings,
    provenance,
    // Q1.1.10/42 - a RESTRICTED-coverage result is real, not fabricated, but must never be presented as equivalent to a normal backtest.
    // A job somehow missing its assessment (should never happen for a job created after Q1.1) is left NORMAL rather than guessed.
    resultDataQualityStatus: dataQuality?.policy === "RESTRICTED" ? "DATA_QUALITY_RESTRICTED" : "NORMAL",
  };
}

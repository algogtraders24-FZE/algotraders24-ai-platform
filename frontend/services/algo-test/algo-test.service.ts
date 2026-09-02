// services/algo-test/algo-test.service.ts
// P3.2B - orchestrates one Algo Test run: validates the request, fetches
// real historical bars via the P3.2A.1 production provider (Twelve Data),
// calls the EXISTING deterministic at24-quant-engine (via
// run-golden-backtest.ts's already-proven composition - never a new
// simulator, never duplicated execution/ledger/metrics/equity math - see
// docs/P3.1-QUANT-CHART-CONTRACT.md and P3.2A-RESULT-CONTRACT.md), and
// persists a bounded, non-huge result record. Every AlgoTestRun row is
// owned by the requesting user's id - never trusted from client input
// (matches paper-trading.service.ts's own ownership convention exactly).
import type { OHLCVBar, SimulationResult, SimulationTrade, Timeframe } from "at24-quant-engine";
import { prisma } from "@/lib/prisma";
import type {
  AlgoTestAssumptions,
  AlgoTestEquityPoint,
  AlgoTestErrorCode,
  AlgoTestMetricsView,
  AlgoTestRunRequest,
  AlgoTestRunView,
  AlgoTestTradeView,
} from "@/types/algo-test";
import type { ChartCandle } from "@/types/chart-data";
import { twelveDataHistoricalDataProvider } from "./historical-data/twelve-data-provider";
import { runGoldenBacktest } from "./run-golden-backtest";

// This sprint's deliberately narrow, explicit support surface (P3.2B brief
// SS1: "Do not expand instrument/timeframe coverage yet"). Adding a second
// strategy/symbol/timeframe later is additive here, never a rewrite.
export const SUPPORTED_STRATEGY_IDS = ["golden"] as const;
export const SUPPORTED_SYMBOLS = ["XAUUSD"] as const;
/** SignalTimeframe-shaped (matches the rest of the app's request convention) - mapped to the engine's own Timeframe token below. */
export const SUPPORTED_TIMEFRAMES = ["5m"] as const;
export const DEFAULT_INITIAL_BALANCE = 10_000;

// Gate 5 (P3.2A.1) established Twelve Data's practical single-request bar
// cap is comfortably above the ~1,344-bar week this program has already
// verified; 5,000 bars/request is the vendor-documented ceiling this
// codebase has not independently re-verified beyond that one real test.
// M5 = 288 bars/day (24h * 12), so 5,000 bars ~= 17.4 days - MAX_RANGE_DAYS
// is set below that theoretical ceiling with real margin, not at it, so a
// request never lands exactly on a provider truncation boundary.
export const MAX_RANGE_DAYS = 14;

const SIGNAL_TIMEFRAME_TO_ENGINE_TIMEFRAME: Readonly<Record<string, Timeframe>> = {
  "5m": "M5",
};

interface ValidationFailure {
  code: AlgoTestErrorCode;
  message: string;
}

function validateRequest(request: AlgoTestRunRequest): ValidationFailure | { engineTimeframe: Timeframe; startTime: Date; endTime: Date; initialBalance: number } {
  if (!SUPPORTED_STRATEGY_IDS.includes(request.strategyId as (typeof SUPPORTED_STRATEGY_IDS)[number])) {
    return { code: "INVALID_STRATEGY", message: `Unsupported strategy '${request.strategyId}'. Only the Golden Strategy ("golden") is available this release.` };
  }
  if (!SUPPORTED_SYMBOLS.includes(request.symbol as (typeof SUPPORTED_SYMBOLS)[number])) {
    return { code: "INVALID_SYMBOL", message: `Unsupported symbol '${request.symbol}'. Only ${SUPPORTED_SYMBOLS.join(", ")} is available this release.` };
  }
  const engineTimeframe = SIGNAL_TIMEFRAME_TO_ENGINE_TIMEFRAME[request.timeframe];
  if (!engineTimeframe) {
    return { code: "INVALID_TIMEFRAME", message: `Unsupported timeframe '${request.timeframe}'. Only ${SUPPORTED_TIMEFRAMES.join(", ")} is available this release.` };
  }

  const startTime = new Date(request.startTime);
  const endTime = new Date(request.endTime);
  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
    return { code: "INVALID_DATE_RANGE", message: "startTime/endTime could not be parsed as dates." };
  }
  if (startTime.getTime() >= endTime.getTime()) {
    return { code: "INVALID_DATE_RANGE", message: "startTime must be before endTime." };
  }
  if (endTime.getTime() > Date.now()) {
    return { code: "INVALID_DATE_RANGE", message: "endTime cannot be in the future - this is a historical backtest, not a live/forward test." };
  }
  const rangeDays = (endTime.getTime() - startTime.getTime()) / 86_400_000;
  if (rangeDays > MAX_RANGE_DAYS) {
    return { code: "RANGE_TOO_LARGE", message: `Date range spans ${rangeDays.toFixed(1)} days; the maximum supported range is ${MAX_RANGE_DAYS} days per test.` };
  }

  const initialBalance = request.initialBalance ?? DEFAULT_INITIAL_BALANCE;
  if (!Number.isFinite(initialBalance) || initialBalance <= 0) {
    return { code: "INVALID_DATE_RANGE", message: "initialBalance must be a positive number." };
  }

  return { engineTimeframe, startTime, endTime, initialBalance };
}

// "no valid historical bars" is run-golden-backtest.ts's own thrown message
// (a successful-but-empty provider response); "no data is available" is
// Twelve Data's real HTTP 400 message for a date range outside its
// coverage (confirmed live this sprint - a pre-1990 request genuinely
// returns this, not a silent empty array). Both mean the same thing to a
// user - "there's no historical data for this request" - and are
// deliberately mapped to the same code; anything else (auth/rate-limit/
// transport/JSON-parse failures) stays the more honest, less specific
// PROVIDER_ERROR.
function toAlgoTestErrorCode(message: string): AlgoTestErrorCode {
  if (/no valid historical bars|no data is available/i.test(message)) return "NO_HISTORICAL_DATA";
  return "PROVIDER_ERROR";
}

function toChartCandles(bars: readonly OHLCVBar[]): ChartCandle[] {
  return bars.map((b) => ({ time: b.timestamp, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }));
}

function toTradeView(trade: SimulationTrade): AlgoTestTradeView {
  return {
    tradeId: trade.tradeId,
    symbol: trade.instrument.symbol,
    side: trade.side,
    quantity: trade.quantity,
    entryTime: trade.entryTimestamp,
    entryPrice: trade.entryPrice,
    exitTime: trade.exitTimestamp,
    exitPrice: trade.exitPrice,
    pnl: trade.netPnl,
    grossPnl: trade.grossPnl,
    fees: trade.fees,
    rMultiple: trade.rMultiple,
  };
}

function toMetricsView(result: SimulationResult): AlgoTestMetricsView {
  const m = result.metrics;
  return {
    totalReturn: m.totalReturn ?? 0,
    netProfit: m.netProfit ?? 0,
    grossProfit: m.grossProfit ?? 0,
    grossLoss: m.grossLoss ?? 0,
    profitFactor: m.profitFactor ?? 0,
    winRate: m.winRate ?? 0,
    expectancy: m.expectancy ?? 0,
    maxDrawdown: m.maxDrawdown ?? 0,
    averageTrade: m.averageTrade ?? 0,
    tradeCount: m.tradeCount ?? result.tradeLedger.length,
    averageR: m.averageR,
    totalFees: m.totalFees,
  };
}

// Every field here is the engine's own REAL, currently-in-effect
// assumption (docs/P3.1-EXECUTION-PARITY.md) - read from the first
// trade's own executionMetadata when a trade exists (so this can never
// silently drift from what the engine actually used), falling back to the
// same fixed Zero*/unenforced-margin description the engine's own
// SimulationConfig always uses today when there are zero trades to read
// it from. Never claims broker-realistic.
function buildAssumptions(result: SimulationResult): AlgoTestAssumptions {
  const meta = result.tradeLedger[0]?.executionMetadata;
  return {
    spread: meta ? `${meta.spreadModel} (0 / placeholder)` : "ZeroSpread (0 / placeholder)",
    slippage: meta ? `${meta.slippageModel} (0 / placeholder)` : "ZeroSlippage (0 / placeholder)",
    fees: meta ? `${meta.feeModel} (0 / placeholder)` : "ZeroFee (0 / placeholder)",
    margin: "Leverage is a declared engine assumption, not enforced - position sizing is unconstrained by margin in this backtest.",
  };
}

function toEquityCurveView(equityCurve: readonly { timestamp: number; balance: number }[]): AlgoTestEquityPoint[] {
  return equityCurve.map((p) => ({ timestamp: p.timestamp, balance: p.balance }));
}

export const algoTestService = {
  async runAlgoTest(userId: string, request: AlgoTestRunRequest): Promise<AlgoTestRunView> {
    const validated = validateRequest(request);
    if ("code" in validated) {
      // A pure validation failure never becomes a persisted run - no testId is consumed for a request that was never actually attempted.
      return {
        testId: "",
        status: "failed",
        strategyId: request.strategyId,
        symbol: request.symbol,
        timeframe: request.timeframe,
        startTime: request.startTime,
        endTime: request.endTime,
        initialBalance: request.initialBalance ?? DEFAULT_INITIAL_BALANCE,
        errorCode: validated.code,
        errorMessage: validated.message,
        createdAt: new Date().toISOString(),
      };
    }

    const { engineTimeframe, startTime, endTime, initialBalance } = validated;

    const row = await prisma.algoTestRun.create({
      data: {
        userId,
        strategyId: request.strategyId,
        symbol: request.symbol,
        timeframe: request.timeframe,
        startTime,
        endTime,
        initialBalance,
        status: "pending",
      },
    });

    try {
      const outcome = await runGoldenBacktest(
        { symbol: request.symbol, timeframe: engineTimeframe, startTime: startTime.toISOString(), endTime: endTime.toISOString(), initialBalance },
        twelveDataHistoricalDataProvider,
      );

      const metrics = toMetricsView(outcome.result);
      const trades = outcome.result.tradeLedger.map(toTradeView);
      const equityCurve = toEquityCurveView(outcome.equityCurve);
      const assumptions = buildAssumptions(outcome.result);

      await prisma.algoTestRun.update({
        where: { id: row.id },
        data: {
          status: "completed",
          resultHash: outcome.result.resultHash,
          metrics: metrics as object,
          trades: trades as unknown as object,
          equityCurve: equityCurve as unknown as object,
          assumptions: assumptions as object,
          completedAt: new Date(),
        },
      });

      return {
        testId: row.id,
        status: "completed",
        strategyId: request.strategyId,
        symbol: request.symbol,
        timeframe: request.timeframe,
        startTime: request.startTime,
        endTime: request.endTime,
        initialBalance,
        resultHash: outcome.result.resultHash,
        metrics,
        trades,
        equityCurve,
        assumptions,
        candles: toChartCandles(outcome.bars),
        createdAt: row.createdAt.toISOString(),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = toAlgoTestErrorCode(message);
      await prisma.algoTestRun.update({
        where: { id: row.id },
        data: { status: "failed", errorCode: code, errorMessage: message, completedAt: new Date() },
      });
      return {
        testId: row.id,
        status: "failed",
        strategyId: request.strategyId,
        symbol: request.symbol,
        timeframe: request.timeframe,
        startTime: request.startTime,
        endTime: request.endTime,
        initialBalance,
        errorCode: code,
        errorMessage: message,
        createdAt: row.createdAt.toISOString(),
      };
    }
  },

  async getAlgoTestRun(userId: string, testId: string): Promise<AlgoTestRunView | null> {
    const row = await prisma.algoTestRun.findFirst({ where: { id: testId, userId } });
    if (!row) return null;
    return {
      testId: row.id,
      status: row.status as "completed" | "failed",
      strategyId: row.strategyId,
      symbol: row.symbol,
      timeframe: row.timeframe,
      startTime: row.startTime.toISOString(),
      endTime: row.endTime.toISOString(),
      initialBalance: row.initialBalance,
      resultHash: row.resultHash ?? undefined,
      metrics: (row.metrics as AlgoTestMetricsView | null) ?? undefined,
      trades: (row.trades as AlgoTestTradeView[] | null) ?? undefined,
      equityCurve: (row.equityCurve as AlgoTestEquityPoint[] | null) ?? undefined,
      assumptions: (row.assumptions as AlgoTestAssumptions | null) ?? undefined,
      // Deliberately no `candles` here - see types/algo-test.ts's own doc
      // comment: candles are only ever present on a fresh POST response.
      errorCode: (row.errorCode as AlgoTestErrorCode | null) ?? undefined,
      errorMessage: row.errorMessage ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  },

  async listAlgoTestRuns(userId: string): Promise<AlgoTestRunView[]> {
    const rows = await prisma.algoTestRun.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50 });
    return rows.map((row) => ({
      testId: row.id,
      status: row.status as "completed" | "failed",
      strategyId: row.strategyId,
      symbol: row.symbol,
      timeframe: row.timeframe,
      startTime: row.startTime.toISOString(),
      endTime: row.endTime.toISOString(),
      initialBalance: row.initialBalance,
      resultHash: row.resultHash ?? undefined,
      metrics: (row.metrics as AlgoTestMetricsView | null) ?? undefined,
      errorCode: (row.errorCode as AlgoTestErrorCode | null) ?? undefined,
      errorMessage: row.errorMessage ?? undefined,
      createdAt: row.createdAt.toISOString(),
    }));
  },
};

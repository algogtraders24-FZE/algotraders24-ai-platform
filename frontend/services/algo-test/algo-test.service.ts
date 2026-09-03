// services/algo-test/algo-test.service.ts
// P3.2B - orchestrates one Algo Test run: validates the request, fetches
// real historical bars via the P3.2A.1 production provider (Twelve Data),
// calls the EXISTING deterministic at24-quant-engine (via run-backtest.ts's
// already-proven composition - never a new simulator, never duplicated
// execution/ledger/metrics/equity math - see docs/P3.1-QUANT-CHART-CONTRACT.md
// and P3.2A-RESULT-CONTRACT.md), and persists a bounded, non-huge result
// record. Every AlgoTestRun row is owned by the requesting user's id -
// never trusted from client input (matches paper-trading.service.ts's own
// ownership convention exactly).
//
// P3.6 (docs/ALGO_TESTING_PRO_ROADMAP.md section 7): this file is now
// strategy-generic. `runAlgoTest` calls `strategy.buildSpec(parameters)`
// and `strategy.buildIndicatorSeries` - both owned by whichever
// StrategyDefinition the request resolved to (strategy-registry.ts) -
// and hands the result to the generic runBacktest(). There is no
// `strategyId === "golden"` branch anywhere in this file, and none is
// needed for the registry's second strategy (ref-ema-crossover) either.
import type { OHLCVBar, SimulationResult, SimulationTrade, Timeframe } from "at24-quant-engine";
import { prisma } from "@/lib/prisma";
import type {
  AlgoTestAssumptions,
  AlgoTestEquityPoint,
  AlgoTestErrorCode,
  AlgoTestMetricsView,
  AlgoTestParameterValues,
  AlgoTestRunRequest,
  AlgoTestRunView,
  AlgoTestTradeView,
} from "@/types/algo-test";
import type { ChartCandle } from "@/types/chart-data";
import { twelveDataHistoricalDataProvider } from "./historical-data/twelve-data-provider";
import { runBacktest } from "./run-backtest";
import { getStrategyDefinition, listAvailableStrategies, validateParameterValues, type StrategyDefinition } from "./strategy-registry";
import { RESULT_CONTRACT_VERSION } from "./result-contract";

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

interface ValidatedRequest {
  strategy: StrategyDefinition;
  engineTimeframe: Timeframe;
  startTime: Date;
  endTime: Date;
  initialBalance: number;
  /** P3.4 - every declared parameter present, defaults filled in, already type/range/step-validated against the strategy's own registered schema. */
  parameters: AlgoTestParameterValues;
}

// P3.3 - centralized, server-side validation, run in this exact order
// (strategy -> symbol -> timeframe -> dates -> balance) BEFORE any
// historical-data fetch or simulation is attempted - the UI's own
// registry-driven pickers (AlgoTestPanel.tsx) make most of these
// unreachable in practice, but the UI is never trusted as the only
// validation layer.
function validateRequest(request: AlgoTestRunRequest): ValidationFailure | ValidatedRequest {
  const strategy = getStrategyDefinition(request.strategyId);
  if (!strategy || strategy.status !== "available") {
    const available = listAvailableStrategies().map((s) => s.strategyId).join(", ") || "(none)";
    return { code: "INVALID_STRATEGY", message: `Unsupported strategy '${request.strategyId}'. Available strategies this release: ${available}.` };
  }
  if (request.strategyVersion !== undefined && request.strategyVersion !== strategy.strategyVersion) {
    return {
      code: "INVALID_STRATEGY_VERSION",
      message: `Strategy '${strategy.strategyId}' is currently registered at version '${strategy.strategyVersion}', not '${request.strategyVersion}'.`,
    };
  }
  const parameterResult = validateParameterValues(strategy, request.parameters);
  if (!parameterResult.ok) {
    return { code: "INVALID_PARAMETERS", message: parameterResult.errors.map((e) => `${e.field}: ${e.message}`).join("; ") };
  }

  if (!strategy.supportedSymbols.includes(request.symbol)) {
    return { code: "INVALID_SYMBOL", message: `Unsupported symbol '${request.symbol}' for strategy '${strategy.strategyId}'. Supported: ${strategy.supportedSymbols.join(", ")}.` };
  }
  if (!strategy.supportedTimeframes.includes(request.timeframe)) {
    return { code: "INVALID_TIMEFRAME", message: `Unsupported timeframe '${request.timeframe}' for strategy '${strategy.strategyId}'. Supported: ${strategy.supportedTimeframes.join(", ")}.` };
  }
  const engineTimeframe = SIGNAL_TIMEFRAME_TO_ENGINE_TIMEFRAME[request.timeframe];
  if (!engineTimeframe) {
    // Structurally unreachable once a timeframe has passed the capability
    // check above (every registry-declared timeframe has a mapping entry),
    // kept as a real, typed guard rather than a non-null assertion so a
    // future registry entry can never silently produce an unmapped engine
    // token here.
    return { code: "INVALID_TIMEFRAME", message: `Timeframe '${request.timeframe}' has no engine mapping.` };
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
    // P3.3 fix: this was previously mis-coded as INVALID_DATE_RANGE (a
    // P3.2B leftover unrelated to the actual field failing) - balance
    // validation gets its own real error code, same "the code names the
    // actual failing field" convention every other branch above already
    // follows.
    return { code: "INVALID_INITIAL_BALANCE", message: "initialBalance must be a finite, positive number." };
  }

  return { strategy, engineTimeframe, startTime, endTime, initialBalance, parameters: parameterResult.normalized };
}

// "no valid historical bars" is run-backtest.ts's own thrown message
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
    // P3.3 - copied straight through from the engine's own SimulationTrade,
    // never fabricated when the engine itself left them unset.
    ...(trade.stopLoss !== undefined ? { stopLoss: trade.stopLoss } : {}),
    ...(trade.takeProfit !== undefined ? { takeProfit: trade.takeProfit } : {}),
    ...(trade.exitReason !== undefined ? { exitReason: trade.exitReason } : {}),
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

    const { strategy, engineTimeframe, startTime, endTime, initialBalance, parameters } = validated;

    const row = await prisma.algoTestRun.create({
      data: {
        userId,
        strategyId: strategy.strategyId,
        // Always the server's own resolved, registered version - never the
        // client-supplied string verbatim (already proven equal above when
        // the client did supply one; when it didn't, this is where the
        // exact version this run executed against first becomes recorded).
        strategyVersion: strategy.strategyVersion,
        // P3.4 - the fully-normalized snapshot (every declared parameter
        // present, defaults filled in) - persisted BEFORE the engine even
        // runs, so the exact configuration attempted is on record even if
        // the run itself later fails.
        parameters: parameters as object,
        symbol: request.symbol,
        timeframe: request.timeframe,
        startTime,
        endTime,
        initialBalance,
        status: "pending",
      },
    });

    try {
      const outcome = await runBacktest(
        {
          symbol: request.symbol,
          timeframe: engineTimeframe,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          initialBalance,
          // P3.6 - the strategy's own buildSpec/buildIndicatorSeries, not a
          // strategyId branch here. `parameters` is already the fully-
          // normalized, already-validated snapshot from validateRequest()
          // above (validateParameterValues() has run).
          strategySpec: strategy.buildSpec(parameters),
          buildIndicatorSeries: strategy.buildIndicatorSeries,
        },
        twelveDataHistoricalDataProvider,
      );

      const metrics = toMetricsView(outcome.result);
      const trades = outcome.result.tradeLedger.map(toTradeView);
      const equityCurve = toEquityCurveView(outcome.equityCurve);
      const assumptions = buildAssumptions(outcome.result);
      const engineVersion = outcome.result.provenance.runtimeVersion;

      await prisma.algoTestRun.update({
        where: { id: row.id },
        data: {
          status: "completed",
          resultHash: outcome.result.resultHash,
          resultVersion: RESULT_CONTRACT_VERSION,
          engineVersion,
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
        strategyId: strategy.strategyId,
        strategyVersion: strategy.strategyVersion,
        resultVersion: RESULT_CONTRACT_VERSION,
        engineVersion,
        parameters,
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
        strategyId: strategy.strategyId,
        strategyVersion: strategy.strategyVersion,
        parameters,
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

  /**
   * P3.3 - a persisted, completed run is reopenable independently of the
   * original running session: every field below is reconstructed from the
   * PERSISTED row alone, and the engine is never re-run. The one exception
   * is `candles` - deliberately never persisted (see the field's own doc
   * comment in types/algo-test.ts) - which is reconstructed here by
   * re-fetching bars for this run's own persisted symbol/timeframe/date
   * range through the SAME read-only historical provider used at run time.
   * This is a read-only data fetch, not a second simulation - the trades/
   * metrics/equityCurve/resultHash returned are 100% the original
   * persisted values, untouched.
   */
  async getAlgoTestRun(userId: string, testId: string): Promise<AlgoTestRunView | null> {
    const row = await prisma.algoTestRun.findFirst({ where: { id: testId, userId } });
    if (!row) return null;

    const view: AlgoTestRunView = {
      testId: row.id,
      status: row.status as "completed" | "failed",
      strategyId: row.strategyId,
      strategyVersion: row.strategyVersion ?? undefined,
      resultVersion: row.resultVersion ?? undefined,
      engineVersion: row.engineVersion ?? undefined,
      // P3.4 - undefined for a pre-P3.4 row (never backfilled) exactly as
      // undefined for a strategy with no declared parameters - both are
      // honest "no snapshot to show," never conflated with "used today's
      // defaults." See types/algo-test.ts's own doc comment on this field.
      parameters: (row.parameters as AlgoTestParameterValues | null) ?? undefined,
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
      errorCode: (row.errorCode as AlgoTestErrorCode | null) ?? undefined,
      errorMessage: row.errorMessage ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };

    if (row.status === "completed") {
      const engineTimeframe = SIGNAL_TIMEFRAME_TO_ENGINE_TIMEFRAME[row.timeframe];
      if (engineTimeframe) {
        try {
          const { bars } = await twelveDataHistoricalDataProvider.getBars({
            symbol: row.symbol,
            timeframe: engineTimeframe,
            startTime: row.startTime.toISOString(),
            endTime: row.endTime.toISOString(),
          });
          view.candles = toChartCandles(bars);
        } catch {
          // Best-effort: a provider hiccup on reopen must never turn an
          // already-successfully-persisted result into an error - the
          // metrics/trades/equityCurve above remain fully intact either
          // way, only the chart overlay is unavailable this reopen.
        }
      }
    }

    return view;
  },

  async listAlgoTestRuns(userId: string): Promise<AlgoTestRunView[]> {
    const rows = await prisma.algoTestRun.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50 });
    return rows.map((row) => ({
      testId: row.id,
      status: row.status as "completed" | "failed",
      strategyId: row.strategyId,
      strategyVersion: row.strategyVersion ?? undefined,
      resultVersion: row.resultVersion ?? undefined,
      engineVersion: row.engineVersion ?? undefined,
      parameters: (row.parameters as AlgoTestParameterValues | null) ?? undefined,
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

  /** P3.3 - the Strategy Registry's own available-strategies list, for the registry-backed UI (GET /api/private/algo-test/strategies). */
  listStrategies(): readonly StrategyDefinition[] {
    return listAvailableStrategies();
  },
};

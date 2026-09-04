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
import {
  buildLifecycleResult,
  computeSemanticStrategyHash,
  type Expression,
  type Operand,
  type OHLCVBar,
  type RiskSpecification,
  type SimulationResult,
  type SimulationTrade,
  type StageResult,
  type StrategyLifecycleStage,
  type StrategySpec,
  type Timeframe,
} from "at24-quant-engine";
import { prisma } from "@/lib/prisma";
import type {
  AlgoTestAssumptions,
  AlgoTestCompiledParameterView,
  AlgoTestCompiledStrategyView,
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
import type { HistoricalDataProvider } from "./historical-data/types";
import { runBacktest } from "./run-backtest";
import { getStrategyDefinition, listAvailableStrategies, validateParameterValues, type StrategyDefinition } from "./strategy-registry";
import { RESULT_CONTRACT_VERSION } from "./result-contract";
// P4 Phase 2 - AI-compiled strategies reuse this EXACT generic backtest
// path (runBacktest, above) - never a separate "AI backtester". See
// docs/P4-PHASE2-BACKTEST-WIRING.md.
import { ClaudeProvider } from "@/lib/ai/providers/claude.provider";
import type { AIProvider } from "@/lib/ai/provider.interface";
import { compileNaturalLanguageStrategy } from "./nl-strategy-compiler.service";
import type { AiCompileAndRunRequest } from "@/types/algo-test";

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

/**
 * P3.8 - Validation / Evidence Gate (docs/ALGO_TESTING_PRO_ROADMAP.md
 * section 9, docs/P3.8-VALIDATION-EVIDENCE-GATE.md). Combines the
 * strategy's own pre-computed IMPORTED/PARSED/IR_VALID/EXECUTION_VALID
 * stages (`strategy.importLifecycle`, computed once at module load - see
 * strategy-registry.ts) with the four per-run stages this function
 * derives from this specific request's real outcome. Never invents a
 * judgment: DATA_VALID/BACKTEST_VALID/REPRODUCIBLE are read straight off
 * outcome fields that already existed (`barsUsed`, having a `result` at
 * all, `outcome.reproducible`); EVIDENCE_VERIFIED's own detail names the
 * real trade count so a zero-trade result is never silently equated with
 * "nothing was proven" or, in the other direction, presented as
 * equivalent evidentiary weight to a real, populated trade ledger - see
 * that stage's own comment below.
 */
// P4 Phase 2 - takes `importLifecycle` directly (a strategy's own 4-stage
// IMPORTED/PARSED/IR_VALID/EXECUTION_VALID array) rather than a full
// StrategyDefinition, so this SAME function serves both a registry entry
// (strategy.importLifecycle) and an AI-compiled strategy
// (compileNaturalLanguageStrategy()'s own `stages`, which has the exact
// same shape) - one lifecycle-building function for every strategy
// source, never a second one written for AI-generated runs.
function buildRunLifecycle(importLifecycle: readonly StageResult[], outcome: { barsUsed: number; result: SimulationResult; reproducible: boolean }) {
  const byName = {} as Record<StrategyLifecycleStage, StageResult>;
  for (const s of importLifecycle) byName[s.stage] = s;

  byName.DATA_VALID = { stage: "DATA_VALID", outcome: "PASSED", detail: `${outcome.barsUsed} bar(s) used` };
  byName.BACKTEST_VALID = { stage: "BACKTEST_VALID", outcome: "PASSED", detail: `simulation completed, resultHash ${outcome.result.resultHash.slice(0, 16)}...` };
  byName.REPRODUCIBLE = outcome.reproducible
    ? { stage: "REPRODUCIBLE", outcome: "PASSED", detail: "a second, independent runSimulation() call over the same bars/config produced a byte-identical resultHash" }
    : { stage: "REPRODUCIBLE", outcome: "FAILED", detail: "a second runSimulation() call over the same bars/config produced a DIFFERENT resultHash - a genuine engine-level non-determinism, not an expected outcome" };

  const tradeCount = outcome.result.tradeLedger.length;
  // The distinction the user's own P3.8 spec named explicitly: a
  // zero-trade result is legitimate ONLY because EXECUTION_VALID (already
  // in `strategy.importLifecycle` for an imported strategy, or
  // NOT_APPLICABLE-by-construction for an engine-reference one) already
  // confirmed the entry logic is real, not a placeholder - see
  // docs/P3.6-MULTI-STRATEGY-REGISTRY.md section 2 and
  // docs/P3.8-VALIDATION-EVIDENCE-GATE.md for the G01/ref-ema-crossover
  // case this guards against directly. A strategy that never reached
  // EXECUTION_VALID never reaches this function at all - see the catch
  // block in runAlgoTest.
  byName.EVIDENCE_VERIFIED =
    tradeCount > 0
      ? { stage: "EVIDENCE_VERIFIED", outcome: "PASSED", detail: `${tradeCount} trade(s) - reproducible evidence backed by a populated trade ledger` }
      : {
          stage: "EVIDENCE_VERIFIED",
          outcome: "PASSED",
          detail: "0 trades - a legitimate, reproducible result (EXECUTION_VALID already confirmed real, non-placeholder entry logic; this run's own bars/window simply never satisfied it), not a fabricated or unresolved-strategy zero",
        };

  return buildLifecycleResult(byName);
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

// P4.3 (docs/P4.3-SURFACE-THE-FOUNDATION.md) - a generic, recursive
// renderer over the REAL StrategySpec Expression tree
// (at24-quant-engine's own Expression/Operand union) - never a
// per-strategy special case, so it renders any registry OR AI-compiled
// strategy's real condition identically. Every branch reads directly off
// a real field; there is no "unknown expression shape" fallback that
// invents text - an exhaustive switch means a future Expression variant
// this function doesn't yet handle fails to typecheck here rather than
// silently rendering nothing.
function describeOperand(op: Operand): string {
  if (op.kind === "literal") return String(op.value);
  if (op.kind === "series") return `${op.ref.series}[${op.ref.offset}]`;
  // op.kind === "indicator"
  const { name, params } = op.ref;
  return params.length > 0 ? `${name}(${params.join(",")})` : name;
}

function describeExpression(expr: Expression): string {
  if (expr.type === "comparison") {
    return `${describeOperand(expr.left)} ${expr.operator} ${describeOperand(expr.right)}`;
  }
  if (expr.type === "boolean-reference") {
    const { name, params } = expr.ref;
    return params.length > 0 ? `${name}(${params.join(",")})` : name;
  }
  // expr.type === "logical"
  if (expr.operator === "NOT") return `NOT (${describeExpression(expr.operands[0]!)})`;
  return expr.operands.map((o) => `(${describeExpression(o)})`).join(` ${expr.operator} `);
}

function describeSizing(risk: RiskSpecification): string {
  const s = risk.sizing;
  if (s.method === "fixed-quantity") return `Fixed quantity: ${s.quantity}`;
  if (s.method === "fixed-lot") return `Fixed lot: ${s.lots}`;
  if (s.method === "percent-equity-risk") return `Percent equity risk: ${s.percent}%`;
  return `ATR-based: ${s.atrMultiple}x ATR(${s.atrPeriod})`;
}

function describeStopLoss(risk: RiskSpecification): string | undefined {
  const sl = risk.stopLoss;
  if (!sl) return undefined;
  if (sl.type === "fixed-price") return `Fixed price: ${sl.price}`;
  if (sl.type === "fixed-distance") return `Fixed distance: ${sl.distance}`;
  return `ATR multiple: ${sl.atrMultiple}x ATR(${sl.atrPeriod})`;
}

function describeTakeProfit(risk: RiskSpecification): string | undefined {
  const tp = risk.takeProfit;
  if (!tp) return undefined;
  if (tp.type === "fixed-price") return `Fixed price: ${tp.price}`;
  if (tp.type === "fixed-distance") return `Fixed distance: ${tp.distance}`;
  return `Risk multiple: ${tp.rMultiple}R`;
}

/**
 * P4.3 - the ONE place a real StrategySpec (registry OR AI-compiled,
 * never branched on which) is projected into the wire-safe, human-
 * readable AlgoTestCompiledStrategyView. Deliberately no "Filters" field
 * (see that type's own doc comment) - a compound entry condition's
 * AND-ed clauses surface naturally inside longEntry/shortEntry instead of
 * a fabricated separate field the real StrategySpec does not have.
 */
// P4.3 - exported (not otherwise needed outside this module) so
// scripts/validate-algo-test-compiled-strategy-view.ts can prove this ONE
// projection function is genuinely used for both a registry StrategySpec
// and an AI-compiled one, offline, without needing runAlgoTest's own
// hardcoded (non-injectable) twelveDataHistoricalDataProvider.
export function toCompiledStrategyView(spec: StrategySpec): AlgoTestCompiledStrategyView {
  const longEntries = spec.entryRules.filter((r) => r.direction === "BUY").map((r) => describeExpression(r.condition));
  const shortEntries = spec.entryRules.filter((r) => r.direction === "SELL").map((r) => describeExpression(r.condition));
  const exit =
    spec.exitRules.length > 0
      ? spec.exitRules.map((r) => describeExpression(r.condition)).join("; ")
      : "No separate exit rule declared — position reverses on an opposite-direction entry signal (Q0.5's own atomic reduce-then-reopen behavior).";

  const parameters: AlgoTestCompiledParameterView[] = spec.parameters.map((p) => ({
    key: p.key,
    defaultValue: p.defaultValue,
    ...(p.min !== undefined ? { min: p.min } : {}),
    ...(p.max !== undefined ? { max: p.max } : {}),
  }));

  return {
    name: spec.identity.name,
    version: spec.version,
    ...(spec.instruments[0]?.symbol ? { symbol: spec.instruments[0].symbol } : {}),
    ...(spec.timeframes[0] ? { timeframe: spec.timeframes[0] } : {}),
    ...(longEntries.length > 0 ? { longEntry: longEntries.join("; ") } : {}),
    ...(shortEntries.length > 0 ? { shortEntry: shortEntries.join("; ") } : {}),
    exit,
    positionSizing: describeSizing(spec.risk),
    ...(describeStopLoss(spec.risk) !== undefined ? { stopLoss: describeStopLoss(spec.risk) } : {}),
    ...(describeTakeProfit(spec.risk) !== undefined ? { takeProfit: describeTakeProfit(spec.risk) } : {}),
    parameters,
  };
}

// P4 Phase 2 - extracted from runAlgoTest's own catch block (unchanged
// behavior, just now shared with compileAndRunAiStrategy below) - a
// request that never reaches a completed backtest stops the lifecycle at
// the strategy's own last import-time stage with DATA_VALID marked
// FAILED: neither NO_HISTORICAL_DATA nor the more general PROVIDER_ERROR
// ever represents a genuine engine/strategy problem - both mean "a valid
// StrategySpec existed but no valid data could be obtained to run it
// against," which is exactly what DATA_VALID is for.
function buildDataValidFailureLifecycle(importLifecycle: readonly StageResult[], message: string) {
  const byName = {} as Record<StrategyLifecycleStage, StageResult>;
  for (const s of importLifecycle) byName[s.stage] = s;
  byName.DATA_VALID = { stage: "DATA_VALID", outcome: "FAILED", detail: message };
  for (const s of ["BACKTEST_VALID", "REPRODUCIBLE", "EVIDENCE_VERIFIED"] as const) {
    byName[s] = { stage: s, outcome: "FAILED", detail: "not evaluated — DATA_VALID already failed" };
  }
  return buildLifecycleResult(byName);
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

    // P3.6 - the strategy's own buildSpec, not a strategyId branch here.
    // `parameters` is already the fully-normalized, already-validated
    // snapshot from validateRequest() above (validateParameterValues() has
    // run). Captured in a variable (P4.3) so the SAME built spec feeds
    // both runBacktest() and the strategy-hash/compiled-strategy view
    // below - never rebuilt a second time (which could theoretically
    // diverge if buildSpec ever became non-pure).
    const strategySpec = strategy.buildSpec(parameters);

    try {
      const outcome = await runBacktest(
        {
          symbol: request.symbol,
          timeframe: engineTimeframe,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          initialBalance,
          strategySpec,
          buildIndicatorSeries: strategy.buildIndicatorSeries,
        },
        twelveDataHistoricalDataProvider,
      );

      const metrics = toMetricsView(outcome.result);
      const trades = outcome.result.tradeLedger.map(toTradeView);
      const equityCurve = toEquityCurveView(outcome.equityCurve);
      const assumptions = buildAssumptions(outcome.result);
      const engineVersion = outcome.result.provenance.runtimeVersion;
      const lifecycle = buildRunLifecycle(strategy.importLifecycle, outcome);

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
        lifecycle,
        compiledStrategy: toCompiledStrategyView(strategySpec),
        strategyHash: computeSemanticStrategyHash(strategySpec),
        createdAt: row.createdAt.toISOString(),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = toAlgoTestErrorCode(message);
      const lifecycle = buildDataValidFailureLifecycle(strategy.importLifecycle, message);
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
        lifecycle,
        // P4.3 - the strategy itself was successfully built (this is a
        // DATA_VALID failure, not an EXECUTION_VALID one) - showing it
        // lets the user see exactly what was ABOUT to run even though no
        // data was available to run it against, rather than an empty
        // "strategy" section next to an otherwise-informative failure.
        compiledStrategy: toCompiledStrategyView(strategySpec),
        strategyHash: computeSemanticStrategyHash(strategySpec),
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

  /**
   * P4 Phase 2 (docs/P4-PHASE2-BACKTEST-WIRING.md) - takes the compiled
   * StrategySpec P4 Phase 1's own `compileNaturalLanguageStrategy()`
   * produces and routes it through the EXACT SAME generic `runBacktest()`
   * every registry-based strategy already uses (P3.6) - not a second,
   * AI-specific backtest path. `deps` is injectable purely for testing
   * (a fake AIProvider/HistoricalDataProvider, mirroring
   * validate-nl-strategy-compiler.ts's own P4 Phase 1 convention) -
   * production callers never pass it, defaulting to the real
   * ClaudeProvider/twelveDataHistoricalDataProvider.
   */
  async compileAndRunAiStrategy(userId: string, request: AiCompileAndRunRequest, deps?: { provider?: AIProvider; historicalDataProvider?: HistoricalDataProvider }): Promise<AlgoTestRunView> {
    const startTime = new Date(request.startTime);
    const endTime = new Date(request.endTime);
    const fail = (code: AlgoTestErrorCode, message: string): AlgoTestRunView => ({
      testId: "",
      status: "failed",
      strategyId: "ai-generated",
      symbol: "",
      timeframe: "",
      startTime: request.startTime,
      endTime: request.endTime,
      initialBalance: request.initialBalance ?? DEFAULT_INITIAL_BALANCE,
      errorCode: code,
      errorMessage: message,
      createdAt: new Date().toISOString(),
    });
    if (typeof request.intent !== "string" || request.intent.trim().length === 0) return fail("INVALID_PARAMETERS", "intent must be a non-empty string");
    if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) return fail("INVALID_DATE_RANGE", "startTime/endTime could not be parsed as dates.");
    if (startTime.getTime() >= endTime.getTime()) return fail("INVALID_DATE_RANGE", "startTime must be before endTime.");
    if (endTime.getTime() > Date.now()) return fail("INVALID_DATE_RANGE", "endTime cannot be in the future - this is a historical backtest, not a live/forward test.");
    const rangeDays = (endTime.getTime() - startTime.getTime()) / 86_400_000;
    if (rangeDays > MAX_RANGE_DAYS) return fail("RANGE_TOO_LARGE", `Date range spans ${rangeDays.toFixed(1)} days; the maximum supported range is ${MAX_RANGE_DAYS} days per test.`);
    const initialBalance = request.initialBalance ?? DEFAULT_INITIAL_BALANCE;
    if (!Number.isFinite(initialBalance) || initialBalance <= 0) return fail("INVALID_INITIAL_BALANCE", "initialBalance must be a finite, positive number.");

    const provider = deps?.provider ?? new ClaudeProvider();
    const historicalDataProvider = deps?.historicalDataProvider ?? twelveDataHistoricalDataProvider;
    const compiledAt = Date.now();
    const compilation = await compileNaturalLanguageStrategy(request.intent, provider, {
      strategyId: `ai-${userId}-${compiledAt}`,
      strategyVersion: "1.0.0",
      name: request.intent.slice(0, 80),
      strategyTimezone: "UTC",
      createdAt: compiledAt,
    });

    const symbol = compilation.compiledSpec?.instruments[0]?.symbol ?? "";
    const timeframe = compilation.compiledSpec?.timeframes[0] ?? "";

    const row = await prisma.algoTestRun.create({
      data: {
        userId,
        strategyId: "ai-generated",
        strategyVersion: "1.0.0",
        parameters: { intent: request.intent } as object,
        symbol,
        timeframe,
        startTime,
        endTime,
        initialBalance,
        status: "pending",
      },
    });

    if (!compilation.compiledSpec || !compilation.buildIndicatorSeries) {
      const byName = {} as Record<StrategyLifecycleStage, StageResult>;
      for (const s of compilation.stages) byName[s.stage] = s;
      for (const s of ["DATA_VALID", "BACKTEST_VALID", "REPRODUCIBLE", "EVIDENCE_VERIFIED"] as const) {
        byName[s] = { stage: s, outcome: "FAILED", detail: "not evaluated — compilation did not reach EXECUTION_VALID" };
      }
      const lifecycle = buildLifecycleResult(byName);
      const message = compilation.stages.find((s) => s.outcome === "FAILED")?.detail ?? "Compilation did not reach EXECUTION_VALID";
      await prisma.algoTestRun.update({ where: { id: row.id }, data: { status: "failed", errorCode: "INVALID_STRATEGY", errorMessage: message, completedAt: new Date() } });
      return { testId: row.id, status: "failed", strategyId: "ai-generated", parameters: { intent: request.intent }, symbol, timeframe, startTime: request.startTime, endTime: request.endTime, initialBalance, errorCode: "INVALID_STRATEGY", errorMessage: message, lifecycle, createdAt: row.createdAt.toISOString() };
    }

    try {
      const outcome = await runBacktest(
        {
          symbol,
          timeframe: timeframe as Timeframe,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          initialBalance,
          strategySpec: compilation.compiledSpec,
          buildIndicatorSeries: compilation.buildIndicatorSeries,
        },
        historicalDataProvider,
      );

      const metrics = toMetricsView(outcome.result);
      const trades = outcome.result.tradeLedger.map(toTradeView);
      const equityCurve = toEquityCurveView(outcome.equityCurve);
      const assumptions = buildAssumptions(outcome.result);
      const engineVersion = outcome.result.provenance.runtimeVersion;
      const lifecycle = buildRunLifecycle(compilation.stages, outcome);

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
        strategyId: "ai-generated",
        strategyVersion: "1.0.0",
        resultVersion: RESULT_CONTRACT_VERSION,
        engineVersion,
        parameters: { intent: request.intent },
        symbol,
        timeframe,
        startTime: request.startTime,
        endTime: request.endTime,
        initialBalance,
        resultHash: outcome.result.resultHash,
        metrics,
        trades,
        equityCurve,
        assumptions,
        candles: toChartCandles(outcome.bars),
        lifecycle,
        compiledStrategy: toCompiledStrategyView(compilation.compiledSpec),
        strategyHash: computeSemanticStrategyHash(compilation.compiledSpec),
        createdAt: row.createdAt.toISOString(),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = toAlgoTestErrorCode(message);
      const lifecycle = buildDataValidFailureLifecycle(compilation.stages, message);
      await prisma.algoTestRun.update({ where: { id: row.id }, data: { status: "failed", errorCode: code, errorMessage: message, completedAt: new Date() } });
      return {
        testId: row.id,
        status: "failed",
        strategyId: "ai-generated",
        parameters: { intent: request.intent },
        // P4.3 - the compiled strategy DID exist here (this is a
        // DATA_VALID failure, after EXECUTION_VALID already passed) - see
        // the identical rationale on runAlgoTest's own catch block above.
        compiledStrategy: toCompiledStrategyView(compilation.compiledSpec),
        strategyHash: computeSemanticStrategyHash(compilation.compiledSpec),
        symbol,
        timeframe,
        startTime: request.startTime,
        endTime: request.endTime,
        initialBalance,
        errorCode: code,
        errorMessage: message,
        lifecycle,
        createdAt: row.createdAt.toISOString(),
      };
    }
  },
};

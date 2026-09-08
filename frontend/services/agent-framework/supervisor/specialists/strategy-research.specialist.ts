// services/agent-framework/supervisor/specialists/strategy-research.specialist.ts
// AT24 Agent Framework - A13. The Strategy Research specialist.
//
// PLAN: backtest.run (the actual historical test against the canonical
// at24-quant-engine, via the EXISTING algoTestService) then
// market.intelligence (current-regime context). NO second backtest engine,
// NO second strategy engine.
//
// SYNTHESIS: a deterministic brief that keeps FIVE things separate
// (owner G12):
//   1. hypothesis        - "worth investigating", NOT a claim it works
//   2. backtestResult    - verbatim metrics + resultHash + assumptions from
//                          the tool call; a RESULT, never auto-promoted
//   3. marketContext     - the pipeline's own regime lean, clearly labelled
//                          as current context, not part of the historical test
//   4. conclusion        - a bounded research interpretation of the evidence
//   5. (absent) a trading recommendation - explicitly withheld; no entry,
//      stop, target, size, side or probability-of-profit, at autonomy < 2
//
// NO LLM. Raw goal text is NOT echoed into any scanned string field, and the
// backtest's per-trade rows (which carry "BUY"/"SELL" sides) are NOT copied
// into the output - only aggregate metrics are.

import type { AgentDefinition } from "@/types/agent-framework";
import type { ParsedGoal } from "../goal";
import type { Specialist, SpecialistPlan } from "../specialist";
import type { RunTrace, RunSynthesis } from "../run-planner";
import { isRecord } from "../../tools/tool-implementation";

const PLAN_ORDER = ["backtest.run", "market.intelligence"];

// backtest.run's real scope today (algoTestService SS1): golden / XAUUSD /
// 5m / <= 14 days. The specialist defaults to that and stays under the cap.
const DEFAULT_STRATEGY_ID = "golden";
const DEFAULT_SYMBOL = "XAUUSD";
const DEFAULT_TIMEFRAME = "5m";
const WINDOW_DAYS = 13;

const BULLISH_REGIMES = new Set(["trending-bullish", "breakout"]);
const BEARISH_REGIMES = new Set(["trending-bearish", "breakdown"]);

interface EnvelopeLike {
  symbol?: string;
  timeframe?: string;
  regime?: { regimeType?: string; confidence?: number };
  pipelineVersion?: string;
}
interface IntelContextLike {
  status?: string;
  envelope?: EnvelopeLike;
}
interface BacktestViewLike {
  testId?: string;
  status?: string;
  strategyId?: string;
  symbol?: string;
  timeframe?: string;
  startTime?: string;
  endTime?: string;
  initialBalance?: number;
  resultHash?: string;
  errorCode?: string;
  errorMessage?: string;
  metrics?: Record<string, unknown>;
  assumptions?: Record<string, unknown>;
}

export const strategyResearchSpecialist: Specialist = {
  key: "STRATEGY_RESEARCH",

  planTools(_definition: AgentDefinition, goal: ParsedGoal, boundToolIds: string[]): SpecialistPlan {
    const ordered = [
      ...PLAN_ORDER.filter((id) => boundToolIds.includes(id)),
      ...boundToolIds.filter((id) => !PLAN_ORDER.includes(id)),
    ];
    const requests = ordered.map((toolId) => ({
      toolId,
      input: shapeStrategyInput(toolId, goal),
      rationale:
        toolId === "backtest.run"
          ? "run the actual historical backtest against the canonical quant engine"
          : toolId === "market.intelligence"
            ? "attach current-regime context to the research finding (not part of the historical test)"
            : `bound tool "${toolId}"`,
    }));
    return {
      requests,
      rationale: `strategy-research plan: ${ordered.join(" -> ")} -> hypothesis/result/context/conclusion brief`,
    };
  },

  synthesize(trace: RunTrace, _definition: AgentDefinition, goal: ParsedGoal): RunSynthesis {
    const btCall = trace.toolCalls.find((tc) => tc.toolId === "backtest.run");
    const bt = (btCall?.output ?? null) as BacktestViewLike | null;
    const btOk = btCall?.status === "ok" && bt?.status === "completed" && isRecord(bt?.metrics);

    const intelCall = trace.toolCalls.find((tc) => tc.toolId === "market.intelligence" && tc.status === "ok");
    const ctx = (intelCall?.output ?? null) as IntelContextLike | null;

    // 1. HYPOTHESIS - reconstructed from structured params, never the raw goal text.
    const strategyId = bt?.strategyId ?? pick(goal.raw, "strategyId") ?? DEFAULT_STRATEGY_ID;
    const symbol = bt?.symbol ?? goal.symbol ?? DEFAULT_SYMBOL;
    const timeframe = bt?.timeframe ?? goal.timeframe ?? DEFAULT_TIMEFRAME;
    const hypothesis =
      `Whether the '${strategyId}' strategy on ${symbol} ${timeframe} warrants further research, ` +
      `evaluated here against one historical backtest. This is a research question - not a claim that the ` +
      `strategy is profitable, robust, or should be traded.`;

    // 2. BACKTEST RESULT - verbatim aggregate metrics only (no per-trade rows).
    const m = (isRecord(bt?.metrics) ? bt!.metrics : {}) as Record<string, number>;
    const backtestResult = btOk
      ? {
          testId: bt!.testId ?? null,
          status: "completed" as const,
          strategyId,
          symbol,
          timeframe,
          window: { startTime: bt!.startTime ?? null, endTime: bt!.endTime ?? null },
          initialBalance: bt!.initialBalance ?? null,
          resultHash: bt!.resultHash ?? null,
          metrics: {
            netProfit: num(m.netProfit),
            totalReturn: num(m.totalReturn),
            profitFactor: num(m.profitFactor),
            maxDrawdown: num(m.maxDrawdown),
            tradeCount: num(m.tradeCount),
            expectancy: num(m.expectancy),
            winRate: num(m.winRate),
          },
          assumptions: bt!.assumptions ?? null,
        }
      : {
          testId: bt?.testId ?? null,
          status: "unusable" as const,
          strategyId,
          symbol,
          timeframe,
          reason: bt?.errorCode ?? bt?.status ?? btCall?.status ?? "no backtest result produced",
        };

    // 3. MARKET CONTEXT - the pipeline's OWN regime lean, clearly separate.
    const regimeType = ctx?.status === "resolved" ? ctx.envelope?.regime?.regimeType : undefined;
    const marketContext = {
      resolved: ctx?.status === "resolved" && !!regimeType,
      regimeType: regimeType ?? null,
      regimeConfidence: ctx?.envelope?.regime?.confidence ?? null,
      lean: regimeLean(regimeType),
      pipelineVersion: ctx?.envelope?.pipelineVersion ?? null,
      note: "Current-regime context only. It is not part of the historical backtest and does not validate it.",
    };

    // 4. CONCLUSION - a bounded research interpretation. NOT a recommendation.
    let conclusion: string;
    let supportsFurtherResearch: boolean | null;
    if (!btOk) {
      conclusion =
        `The backtest did not produce a usable result (${backtestResult.status === "unusable" ? (backtestResult as { reason?: string }).reason : "unknown"}). ` +
        `The hypothesis remains unevaluated; no research conclusion can be drawn from this run.`;
      supportsFurtherResearch = null;
    } else if (num(m.netProfit) > 0 && num(m.tradeCount) >= 1) {
      conclusion =
        `Over the tested window and under the stated assumptions, the backtest completed with positive net profit ` +
        `across ${num(m.tradeCount)} simulated position(s). This is evidence that the hypothesis merits further ` +
        `research (out-of-sample windows, parameter sensitivity, cost robustness). It is not proof the strategy is ` +
        `viable in live conditions and is not a trading recommendation.`;
      supportsFurtherResearch = true;
    } else {
      conclusion =
        `Over the tested window and under the stated assumptions, the backtest did not produce positive net profit. ` +
        `This is evidence against prioritising the hypothesis for further research on this configuration.`;
      supportsFurtherResearch = false;
    }

    const disclaimer =
      "A backtest result is not a trading recommendation. No entry, stop, target, position size or probability of " +
      "profit is expressed or implied. Historical simulated performance under the engine's own assumptions does " +
      "not indicate future results. Decision support / research only.";

    const resolved = btOk;

    // The brief is grounded in the backtest and (as context) the regime -
    // cite exactly those. Evidence the intelligence pipeline gathered
    // incidentally (news, cross-asset, ...) is not part of this brief's
    // reasoning and is not cited here; the full trace remains queryable.
    const cited = trace.evidence.filter((e) => e.type === "backtest" || e.type === "regime");

    return {
      output: {
        kind: "strategy-research-brief",
        hypothesis,
        backtestResult,
        marketContext,
        conclusion,
        supportsFurtherResearch,
        resolved,
        notATradeRecommendation: true,
        sources: [...new Set(cited.map((e) => e.source))],
        citedEvidenceCount: cited.length,
        evidenceGathered: trace.evidence.length,
        evidenceIds: cited.map((e) => e.id),
        disclaimer,
      },
      summary: btOk
        ? `strategy research: '${strategyId}' ${symbol} ${timeframe} backtest ${num(m.netProfit) > 0 ? "positive" : "non-positive"} net profit over ${num(m.tradeCount)} position(s) - research evidence, not a recommendation`
        : `strategy research: '${strategyId}' ${symbol} ${timeframe} backtest produced no usable result - hypothesis unevaluated`,
    };
  },
};

function shapeStrategyInput(toolId: string, goal: ParsedGoal): unknown {
  const raw = isRecord(goal.raw) ? goal.raw : {};
  if (toolId === "backtest.run") {
    const end = typeof raw.endTime === "string" ? raw.endTime : new Date().toISOString();
    const start =
      typeof raw.startTime === "string"
        ? raw.startTime
        : new Date(Date.parse(end) - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    return {
      strategyId: typeof raw.strategyId === "string" ? raw.strategyId : DEFAULT_STRATEGY_ID,
      symbol: goal.symbol ?? (typeof raw.symbol === "string" ? raw.symbol : DEFAULT_SYMBOL),
      timeframe: goal.timeframe ?? (typeof raw.timeframe === "string" ? raw.timeframe : DEFAULT_TIMEFRAME),
      startTime: start,
      endTime: end,
      ...(typeof raw.initialBalance === "number" ? { initialBalance: raw.initialBalance } : {}),
    };
  }
  if (toolId === "market.intelligence") {
    return {
      symbol: goal.symbol ?? (typeof raw.symbol === "string" ? raw.symbol : DEFAULT_SYMBOL),
      ...(goal.timeframe ? { timeframe: goal.timeframe } : {}),
    };
  }
  return raw;
}

function regimeLean(regimeType: string | undefined): "bullish-leaning" | "bearish-leaning" | "neutral" {
  if (regimeType && BULLISH_REGIMES.has(regimeType)) return "bullish-leaning";
  if (regimeType && BEARISH_REGIMES.has(regimeType)) return "bearish-leaning";
  return "neutral";
}

function pick(raw: unknown, key: string): string | undefined {
  return isRecord(raw) && typeof raw[key] === "string" ? (raw[key] as string) : undefined;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

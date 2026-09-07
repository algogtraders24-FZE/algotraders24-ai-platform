// services/agent-framework/supervisor/specialists/market-intelligence.specialist.ts
// AT24 Agent Framework - A5. The Market Intelligence specialist.
//
// PLAN: among the agent's bound tools, put market.snapshot first (a cheap
// freshness anchor), then market.intelligence (the deterministic D2.6.5
// pipeline), then any other bound tools in binding order.
//
// SYNTHESIS: read the market.intelligence tool call's persisted output
// (a VerifiedRealTimeIntelligenceContext) and project its ALREADY-COMPUTED
// deterministic regime + hypotheses + intelligence score into a structured
// bullish / bearish / neutral LEAN. This is NOT a signal: no entry, no
// stop, no target, no position size, no probability-of-profit. It is a
// faithful relay of the pipeline's own classification, with an explicit
// decision-support disclaimer. NO LLM, NO new calculation, NO second
// intelligence engine.

import type { AgentDefinition } from "@/types/agent-framework";
import type { ParsedGoal } from "../goal";
import type { Specialist, SpecialistPlan } from "../specialist";
import type { RunTrace, RunSynthesis } from "../run-planner";
import { shapeGoalForTool } from "../plan-shaping";

const BULLISH_REGIMES = new Set(["trending-bullish", "breakout"]);
const BEARISH_REGIMES = new Set(["trending-bearish", "breakdown"]);

type Bias = "bullish-leaning" | "bearish-leaning" | "neutral";

interface EnvelopeLike {
  symbol?: string;
  timeframe?: string;
  regime?: { regimeType?: string; confidence?: number; basis?: string[] };
  hypotheses?: Array<{ type?: string; statement?: { claim?: string } }>;
  intelligenceScore?: unknown;
  pipelineVersion?: string;
}
interface IntelContextLike {
  status?: string;
  envelope?: EnvelopeLike;
  generatedAt?: string;
}

function biasFromRegime(regimeType: string | undefined): Bias {
  if (regimeType && BULLISH_REGIMES.has(regimeType)) return "bullish-leaning";
  if (regimeType && BEARISH_REGIMES.has(regimeType)) return "bearish-leaning";
  return "neutral";
}

function biasFromHypotheses(hyps: EnvelopeLike["hypotheses"]): { bias: Bias; bull: number; bear: number } {
  let bull = 0;
  let bear = 0;
  for (const h of hyps ?? []) {
    const t = h.type ?? "";
    if (t.endsWith("bullish")) bull += 1;
    else if (t.endsWith("bearish")) bear += 1;
  }
  const bias: Bias = bull > bear ? "bullish-leaning" : bear > bull ? "bearish-leaning" : "neutral";
  return { bias, bull, bear };
}

export const marketIntelligenceSpecialist: Specialist = {
  key: "MARKET_INTELLIGENCE",

  planTools(definition: AgentDefinition, goal: ParsedGoal, boundToolIds: string[]): SpecialistPlan {
    const order = ["market.snapshot", "market.intelligence"];
    const ordered = [
      ...order.filter((id) => boundToolIds.includes(id)),
      ...boundToolIds.filter((id) => !order.includes(id)),
    ];
    const requests = ordered.map((toolId) => ({
      toolId,
      input: shapeGoalForTool(toolId, goal),
      rationale:
        toolId === "market.intelligence"
          ? "run the deterministic real-time intelligence pipeline for the goal symbol"
          : toolId === "market.snapshot"
            ? "anchor freshness with a live quote before the pipeline run"
            : `bound tool "${toolId}"`,
    }));
    return {
      requests,
      rationale: `market-intelligence plan: ${ordered.join(" -> ")} -> deterministic bias synthesis`,
    };
  },

  synthesize(trace: RunTrace, definition: AgentDefinition, goal: ParsedGoal): RunSynthesis {
    const intelCall = trace.toolCalls.find((tc) => tc.toolId === "market.intelligence" && tc.status === "ok");
    const ctx = (intelCall?.output ?? null) as IntelContextLike | null;
    const envelope = ctx?.envelope;

    const disclaimer =
      "Decision support only. This is the platform's deterministic regime classification for the " +
      "instrument, not a trade recommendation. No entry, stop, target, position size or probability of profit.";

    if (!ctx || ctx.status !== "resolved" || !envelope || !envelope.regime) {
      return {
        output: {
          kind: "market-intelligence-conclusion",
          symbol: goal.symbol ?? null,
          bias: "neutral" as Bias,
          resolved: false,
          reason: ctx?.status ?? "no intelligence context produced",
          evidenceCount: trace.evidence.length,
          evidenceIds: trace.evidence.map((e) => e.id),
          disclaimer,
        },
        summary: `market intelligence for ${goal.symbol ?? "instrument"}: unresolved (${ctx?.status ?? "no context"})`,
      };
    }

    const regimeType = envelope.regime.regimeType;
    const regimeBias = biasFromRegime(regimeType);
    const hyp = biasFromHypotheses(envelope.hypotheses);

    // Combine: regime and hypotheses must agree for a directional lean;
    // any disagreement or a neutral regime -> neutral.
    let bias: Bias = "neutral";
    if (regimeBias !== "neutral" && (hyp.bias === regimeBias || hyp.bias === "neutral")) {
      bias = regimeBias;
    } else if (regimeBias === "neutral" && hyp.bias !== "neutral") {
      bias = "neutral"; // hypotheses alone are not enough without regime support
    }

    const basis: string[] = [
      `regime: ${regimeType} (confidence ${envelope.regime.confidence ?? "n/a"})`,
      `hypotheses: ${hyp.bull} bullish / ${hyp.bear} bearish of ${envelope.hypotheses?.length ?? 0}`,
      ...(envelope.regime.basis ?? []).slice(0, 4),
    ];

    return {
      output: {
        kind: "market-intelligence-conclusion",
        symbol: envelope.symbol ?? goal.symbol ?? null,
        timeframe: envelope.timeframe ?? goal.timeframe ?? null,
        bias,
        resolved: true,
        regimeType,
        regimeConfidence: envelope.regime.confidence ?? null,
        hypothesisCount: envelope.hypotheses?.length ?? 0,
        pipelineVersion: envelope.pipelineVersion ?? null,
        basis,
        evidenceIds: trace.evidence.map((e) => e.id),
        disclaimer,
      },
      summary: `market intelligence for ${envelope.symbol ?? goal.symbol}: ${bias} (regime ${regimeType})`,
    };
  },
};

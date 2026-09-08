import type { StrategyIR } from "../../domain/strategy-ir/strategy-ir.js";
import type { SimulationFidelity } from "../../domain/fidelity/simulation-fidelity.js";
import type { ExecutionCompatibilityReport, FeatureCompatibility, CapabilityStatus } from "../../domain/strategy-ir/execution-compatibility.js";

const WORST: Record<CapabilityStatus, number> = { SUPPORTED: 0, PARTIAL: 1, UNSUPPORTED: 2, BLOCKED: 3 };

function worstOf(a: CapabilityStatus, b: CapabilityStatus): CapabilityStatus {
  return WORST[a] >= WORST[b] ? a : b;
}

/**
 * Q0.7.39 — checks a StrategyIR's declared features against what
 * `runtime/simulation/simulation-engine.ts` (Q0.5, frozen) and
 * `runtime/fidelity/multi-fidelity-engine.ts` (Q0.6, frozen) actually
 * implement TODAY. Every row below traces to a specific, documented
 * fact from those sprints' own docs (docs/Q0.5_EXECUTION_MODEL.md,
 * docs/Q0.5_POSITION_ACCOUNT.md, docs/Q0.6_D2_D3_EXECUTION.md) — this
 * function does not guess engine capability, it encodes what those
 * sprints already documented as shipped vs. a known limitation.
 */
export function computeExecutionCompatibility(ir: StrategyIR, targetFidelity: SimulationFidelity): ExecutionCompatibilityReport {
  const features: FeatureCompatibility[] = [];

  for (const entry of ir.entries) {
    features.push({
      feature: `entry "${entry.id}" order type ${entry.executionType}`,
      requiredCapability: entry.executionType,
      availableCapability: "MARKET | LIMIT | STOP | STOP_LIMIT",
      status: "SUPPORTED", // Q0.5's order-engine implements all four (docs/Q0.5_ORDER_ENGINE.md)
    });
    if (entry.sizingModel.method === "atr-based") {
      features.push({
        feature: `entry "${entry.id}" sizing method atr-based`,
        requiredCapability: "atr-based position sizing formula",
        status: "UNSUPPORTED",
        note: "Q0.5's resolvePositionSize() throws explicitly for atr-based sizing — no resolved formula exists yet (docs/Q0.5_EXECUTION_MODEL.md Known Limitation)",
      });
    }
  }

  for (const exit of ir.exits) {
    if (exit.kind === "SIGNAL_EXIT") {
      // Q1.5.3 — StrategySpec.exitRules is now genuinely evaluated by both
      // simulation engines (see docs/Q1.5_EXIT_CONTRACT.md). SUPPORTED
      // requires a real, structurally valid condition — one declared
      // without a condition can never be evaluated and stays UNSUPPORTED,
      // never silently promoted.
      features.push(
        exit.condition !== undefined
          ? { feature: `exit "${exit.id}" kind SIGNAL_EXIT`, requiredCapability: "StrategySpec.exitRules evaluation", status: "SUPPORTED" }
          : { feature: `exit "${exit.id}" kind SIGNAL_EXIT`, requiredCapability: "StrategySpec.exitRules evaluation", status: "UNSUPPORTED", note: "a SIGNAL_EXIT with no condition has nothing to evaluate" },
      );
    } else if (exit.kind === "SESSION_EXIT") {
      features.push({
        feature: `exit "${exit.id}" kind SESSION_EXIT`,
        requiredCapability: "forced position close at session-window end",
        status: "UNSUPPORTED",
        note: "RiskSpecification.sessionHours gates NEW entries only (Q0.2) — no forced-exit-at-session-end evaluator exists in Q0.3's evaluateRisk()",
      });
    } else {
      features.push({
        feature: `exit "${exit.id}" kind ${exit.kind}`,
        requiredCapability: exit.kind,
        status: "SUPPORTED", // STOP_LOSS/TAKE_PROFIT/TIME_EXIT/RISK_EXIT all map to Q0.3's evaluateRisk()-driven RiskSpecification fields
      });
    }
  }

  features.push({
    feature: `position accounting mode ${ir.positionManagement.accountingMode}`,
    requiredCapability: ir.positionManagement.accountingMode,
    availableCapability: "NETTING",
    status: ir.positionManagement.accountingMode === "NETTING" ? "SUPPORTED" : "UNSUPPORTED",
    ...(ir.positionManagement.accountingMode !== "NETTING" ? { note: "Q0.5 implements NETTING only; HEDGING is a reserved, unimplemented type (docs/Q0.5_POSITION_ACCOUNT.md)" } : {}),
  });

  for (const series of ir.timeframeSeries) {
    if (series.role === "LOWER") {
      const supported = targetFidelity === "D2_LOWER_TIMEFRAME" || targetFidelity === "D3_M1";
      features.push({
        feature: `timeframeSeries (${series.timeframe}, role LOWER)`,
        requiredCapability: "child-bar-walking intrabar execution",
        availableCapability: "D2_LOWER_TIMEFRAME / D3_M1 only",
        status: supported ? "SUPPORTED" : "UNSUPPORTED",
        ...(!supported ? { note: `targetFidelity is "${targetFidelity}" — lower-timeframe execution detail requires D2/D3 (docs/Q0.6_D2_D3_EXECUTION.md)` } : {}),
      });
    } else if (series.role === "HIGHER") {
      features.push({
        feature: `timeframeSeries (${series.timeframe}, role HIGHER)`,
        requiredCapability: "dual-timeframe strategy calculation",
        status: "UNSUPPORTED",
        note: "No genuine dual-timeframe STRATEGY exists yet — signal generation stays single-timeframe (docs/Q0.6_MTF_SAFETY.md)",
      });
    }
  }

  if (ir.repaintingModel === "REPAINTING" || ir.repaintingModel === "UNKNOWN") {
    features.push({
      feature: `repaintingModel ${ir.repaintingModel}`,
      requiredCapability: "resolved (non-repainting or confirmed-only) semantics",
      status: "BLOCKED",
      note: "Q0.7.22: unresolved repainting semantics may never receive a clean validated/executable status",
    });
  }

  const overallStatus = features.reduce<CapabilityStatus>((acc, f) => worstOf(acc, f.status), "SUPPORTED");

  return { targetFidelity, features, overallStatus };
}

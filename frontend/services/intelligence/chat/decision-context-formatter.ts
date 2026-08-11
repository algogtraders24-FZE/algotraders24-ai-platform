// services/intelligence/chat/decision-context-formatter.ts
// Sprint D2.6.5 - Real-Time Intelligence Context + Trader Chat Integration.
// Pure, deterministic, I/O-free: turns a real IntelligenceDecisionContext
// (D2.6.1, itself built only from D2.5.1-D2.5.5's real outputs) into plain
// structured text. Two, and only two, callers:
//  - DeterministicSafeFallbackPresenter returns this text VERBATIM as the
//    trader-facing response when no LLM is available/trusted.
//  - GeminiIntelligencePresenter feeds this text to the LLM as the
//    "verified facts" block it is instructed to paraphrase, never invent
//    beyond.
// Every section header matches the sprint's own §12 worked example
// (Current State / Regime / Supporting Evidence / Opposing Evidence /
// Hypotheses / Invalidation / Risk / Historical Validation / Intelligence
// Score / Missing Information) so the deterministic fallback and the
// LLM-paraphrased response are recognizably drawing from the same facts.
import type { IntelligenceDecisionContext } from "@/types/intelligence-decision-context";

export const DECISION_CONTEXT_FORMATTER_VERSION = "1.0.0";

function formatEvidenceItem(item: { claim: string; source: string; asOf: string }): string {
  return `- ${item.claim} (source: ${item.source}, as of ${item.asOf})`;
}

export function formatDecisionContextAsText(dc: IntelligenceDecisionContext): string {
  const lines: string[] = [];

  lines.push(`${dc.symbol} (${dc.timeframe}) - Decision context state: ${dc.state}`);
  lines.push("");

  lines.push("## Current State");
  lines.push(`Price: ${dc.currentState.price}`);
  if (dc.currentState.trendDirection) lines.push(`Trend: ${dc.currentState.trendDirection}`);
  if (dc.currentState.rsi14 !== undefined) lines.push(`RSI(14): ${dc.currentState.rsi14.toFixed(2)}`);
  if (dc.currentState.atr14 !== undefined) lines.push(`ATR(14): ${dc.currentState.atr14.toFixed(4)}`);
  if (dc.currentState.volatilityBand) lines.push(`Volatility: ${dc.currentState.volatilityBand}`);
  if (dc.currentState.breakoutSignal) lines.push(`Breakout signal: ${dc.currentState.breakoutSignal}`);
  for (const b of dc.currentState.basis) lines.push(`- ${b}`);
  lines.push("");

  lines.push("## Regime");
  lines.push(`${dc.regimeContext.regimeType} (confidence ${dc.regimeContext.confidence}/100, reliable: ${dc.regimeContext.isReliable})`);
  for (const b of dc.regimeContext.basis) lines.push(`- ${b}`);
  lines.push("");

  lines.push("## Supporting Evidence");
  if (dc.supportingEvidence.length === 0) lines.push("None available.");
  else for (const item of dc.supportingEvidence) lines.push(formatEvidenceItem(item));
  lines.push("");

  lines.push("## Opposing Evidence");
  if (dc.opposingEvidence.length === 0) lines.push("None available.");
  else for (const item of dc.opposingEvidence) lines.push(formatEvidenceItem(item));
  lines.push("");

  if (dc.unresolvedConflicts.length > 0) {
    lines.push("## Unresolved Conflicts (never auto-resolved - both sides are real)");
    for (const c of dc.unresolvedConflicts) lines.push(`- ${c.reason}`);
    lines.push("");
  }

  lines.push("## Hypotheses");
  if (dc.primaryHypotheses.length === 0) lines.push("No hypothesis was generated for the current regime.");
  else {
    for (const h of dc.primaryHypotheses) {
      lines.push(`- [${h.type}] ${h.claim}`);
      lines.push(`  Prediction window: ${h.predictionWindow.candles} candles (${h.predictionWindow.timeframe})`);
      lines.push(`  Invalidated if: ${h.invalidationCondition.description}`);
    }
  }
  lines.push("");

  lines.push("## Invalidation Conditions");
  if (dc.invalidationConditions.length === 0) lines.push("None.");
  else for (const inv of dc.invalidationConditions) lines.push(`- ${inv.description}`);
  lines.push("");

  lines.push("## Risk");
  if (!dc.riskContext.dataAvailable) lines.push("No risk profile was available for this analysis.");
  else {
    if (dc.riskContext.overallLevel) lines.push(`Overall level: ${dc.riskContext.overallLevel}`);
    for (const b of dc.riskContext.basis) lines.push(`- ${b}`);
  }
  lines.push("");

  lines.push("## Historical Validation");
  if (dc.historicalContext.status !== "available") {
    lines.push(`Status: ${dc.historicalContext.status}.`);
  } else {
    lines.push(`Sample size: ${dc.historicalContext.sampleSize}, validated rate: ${((dc.historicalContext.validatedRate ?? 0) * 100).toFixed(1)}%`);
  }
  for (const b of dc.historicalContext.basis) lines.push(`- ${b}`);
  lines.push("");

  lines.push("## Intelligence Score");
  lines.push(`Overall: ${dc.intelligenceScore.overallScore ?? "not computable"} / 100 (this measures evidence quality/completeness/agreement - NEVER a probability of profit or trade success)`);
  for (const b of dc.intelligenceScore.basis) lines.push(`- ${b}`);
  lines.push("");

  lines.push("## Missing Information");
  if (dc.missingInformation.length === 0) lines.push("None noted.");
  else for (const m of dc.missingInformation) lines.push(`- [${m.kind}] ${m.description} (${m.affectedArea})`);

  return lines.join("\n");
}

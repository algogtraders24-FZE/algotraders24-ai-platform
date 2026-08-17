// services/intelligence/microstructure/microstructure-evidence-assessment.service.ts
// Sprint D2.8.11 - Microstructure-Aware Decision Intelligence & Evidence
// Fusion. The ONE new deterministic function this sprint adds: compares a
// real, already-computed MicrostructureSnapshot (D2.8.5, unmodified) against
// the active hypothesis's real direction (D2.5.3, unmodified) and produces a
// MicrostructureEvidenceAssessment. Pure and synchronous - no I/O, no clock
// read (generatedAt is a caller-supplied parameter, same discipline
// DecisionContextService itself already follows: "no new clock read -
// generatedAt is reused verbatim"). No calculation from D2.8.5's own
// microstructure-calculation.ts is reimplemented here - this function only
// reads already-computed derived fields and their already-assigned
// CapabilityState, exactly like every other D2.6.1+ decision-layer
// consumer of real engine output.
import type { HypothesisType } from "@/types/intelligence-hypothesis";
import type { MicrostructureSnapshot } from "@/types/microstructure";
import type {
  MicrostructureEvidenceAssessment,
  MicrostructureDirectionalBalance,
  MicrostructureEvidenceStrength,
} from "@/types/microstructure-evidence-assessment";
import { MICROSTRUCTURE_EVIDENCE_ASSESSMENT_VERSION } from "@/types/microstructure-evidence-assessment";

/**
 * V1 heuristic, documented and versioned exactly like
 * DecisionContextService's own WELL_SUPPORTED_SCORE_THRESHOLD /
 * AIResponseIntegrityService's own PRICE_CLAIM_RELATIVE_TOLERANCE - a
 * relative/normalized boundary (both signals below are already ratios in
 * [-1, 1]), never an arbitrary absolute price/volume number. Net pressure
 * magnitude below this is classified "neutral" - real evidence, genuinely
 * too small to call a direction. Above STRONG_PRESSURE_THRESHOLD is
 * classified "strong".
 */
const NEUTRAL_PRESSURE_BAND = 0.15;
const STRONG_PRESSURE_THRESHOLD = 0.5;

interface HypothesisTypeLike {
  type: HypothesisType;
}

function directionForHypothesisType(type: HypothesisType): "bullish" | "bearish" | "neutral" {
  if (type.endsWith("bullish")) return "bullish";
  if (type.endsWith("bearish")) return "bearish";
  return "neutral";
}

function insufficient(
  base: { generatedAt: string; version: string },
  attribution: Partial<MicrostructureEvidenceAssessment>,
  basis: string[],
): MicrostructureEvidenceAssessment {
  return { ...base, ...attribution, status: "insufficient_evidence", balance: "neutral", evidenceStrength: "none", basis };
}

/**
 * Pure, deterministic: identical (snapshot, hypothesis, generatedAt) always
 * produces an identical result. Never fabricates a directional value when
 * evidence is missing/stale/invalid/insufficient - see D2.8.11's own
 * fabrication-safety tests for every required gate.
 */
export function assessMicrostructureEvidence(
  snapshot: MicrostructureSnapshot | undefined,
  hypothesis: HypothesisTypeLike | undefined,
  generatedAt: string,
): MicrostructureEvidenceAssessment {
  const base = { generatedAt, version: MICROSTRUCTURE_EVIDENCE_ASSESSMENT_VERSION };

  if (!snapshot) {
    return insufficient(base, {}, ["No microstructure evidence was available for this instrument/request."]);
  }

  const attribution: Partial<MicrostructureEvidenceAssessment> = {
    provider: snapshot.provider,
    instrument: snapshot.symbol,
    freshness: snapshot.freshnessStatus,
    timestamp: snapshot.timestamp,
  };

  // Sprint D2.8.11 Phase 6 - a snapshot whose freshness check failed (stale/
  // unknown/invalid) is never used to confirm or contradict a hypothesis,
  // even though D2.8.5 still carries the real values for display elsewhere.
  if (snapshot.freshnessStatus !== "fresh") {
    return insufficient(base, attribution, [
      `Microstructure evidence freshness is "${snapshot.freshnessStatus}" - only fresh evidence is used to assess hypothesis confirmation.`,
    ]);
  }

  // Sprint D2.8.11 Phase 6 - a crossed/invalid top-of-book casts doubt on
  // the whole snapshot's reliability for directional assessment, even if
  // depth/volume fields independently still compute - a deliberately
  // conservative gate, never repaired or partially trusted.
  if (snapshot.evidence.bid.state === "invalid" || snapshot.evidence.ask.state === "invalid") {
    return insufficient(base, attribution, [
      "The underlying bid/ask evidence is invalid (e.g. a crossed market) - this snapshot is not used for directional assessment.",
    ]);
  }

  const signals: number[] = [];
  const basis: string[] = [];

  // Signal 1: order-book depth imbalance - already a normalized ratio in
  // [-1, 1] from D2.8.5's own computeDepthImbalance(), never recomputed
  // here. Only used when genuinely "available" - "unavailable"/"invalid"/
  // "not_supported_by_provider" are all excluded identically (this
  // function never distinguishes WHY a field isn't usable, only THAT it
  // isn't - the reason is already preserved on the snapshot itself for
  // display).
  if (snapshot.derived.depthImbalance.state === "available") {
    const value = snapshot.derived.depthImbalance.value as number;
    signals.push(value);
    basis.push(`Order-book depth imbalance is ${value.toFixed(3)} (positive = bid-side depth dominance, negative = ask-side).`);
  }

  // Signal 2: aggressor-mapped volume delta, normalized by total real
  // traded volume so it is comparable in magnitude to the depth-imbalance
  // ratio above - never a raw absolute unit. Only used when buyVolume,
  // sellVolume, AND volumeDelta are all genuinely "available" - D2.8.5's
  // own computeAggressorVolumes() already leaves these "unavailable"
  // whenever real aggressor-side evidence (Binance's isBuyerMaker) was
  // missing, so "no genuine aggressor evidence -> no delta signal" is
  // enforced by reusing that existing gate, never a second check.
  if (
    snapshot.derived.volumeDelta.state === "available" &&
    snapshot.derived.buyVolume.state === "available" &&
    snapshot.derived.sellVolume.state === "available"
  ) {
    const buy = snapshot.derived.buyVolume.value as number;
    const sell = snapshot.derived.sellVolume.value as number;
    const total = buy + sell;
    if (total > 0) {
      const ratio = (snapshot.derived.volumeDelta.value as number) / total;
      signals.push(ratio);
      basis.push(`Real aggressor-mapped trade flow: buy volume ${buy}, sell volume ${sell}, volume delta normalized to ${ratio.toFixed(3)}.`);
    }
  }

  if (signals.length === 0) {
    return insufficient(base, attribution, [
      "No usable directional microstructure signal (order-book depth imbalance or aggressor-mapped volume delta) was available.",
    ]);
  }

  const netPressure = signals.reduce((sum, value) => sum + value, 0) / signals.length;
  const magnitude = Math.abs(netPressure);
  const balance: MicrostructureDirectionalBalance = magnitude < NEUTRAL_PRESSURE_BAND ? "neutral" : netPressure > 0 ? "bullish" : "bearish";
  const evidenceStrength: MicrostructureEvidenceStrength =
    magnitude < NEUTRAL_PRESSURE_BAND ? "weak" : magnitude < STRONG_PRESSURE_THRESHOLD ? "moderate" : "strong";
  const bullishPressure = Math.max(netPressure, 0);
  const bearishPressure = Math.max(-netPressure, 0);

  const directional: Partial<MicrostructureEvidenceAssessment> & { balance: MicrostructureDirectionalBalance; evidenceStrength: MicrostructureEvidenceStrength } = {
    ...attribution,
    bullishPressure,
    bearishPressure,
    balance,
    evidenceStrength,
  };

  if (!hypothesis) {
    return {
      ...base,
      ...directional,
      status: "insufficient_evidence",
      basis: [...basis, "No active hypothesis exists to compare this microstructure evidence against."],
    };
  }

  const hypothesisDirection = directionForHypothesisType(hypothesis.type);
  if (hypothesisDirection === "neutral") {
    return {
      ...base,
      ...directional,
      hypothesisType: hypothesis.type,
      hypothesisDirection,
      status: "insufficient_evidence",
      basis: [...basis, `The active hypothesis ("${hypothesis.type}") is non-directional - microstructure directional pressure cannot confirm or contradict it.`],
    };
  }

  let status: MicrostructureEvidenceAssessment["status"];
  if (balance === "neutral") {
    status = "neutral";
    basis.push(`Net microstructure pressure (${netPressure.toFixed(3)}) is within the neutral band - insufficient to confirm or contradict the ${hypothesisDirection} hypothesis.`);
  } else if (balance === hypothesisDirection) {
    status = "confirms";
    basis.push(`${balance === "bullish" ? "Bullish" : "Bearish"} microstructure pressure aligns with the active ${hypothesisDirection} hypothesis.`);
  } else {
    status = "contradicts";
    basis.push(`${balance === "bullish" ? "Bullish" : "Bearish"} microstructure pressure opposes the active ${hypothesisDirection} hypothesis.`);
  }

  return { ...base, ...directional, hypothesisType: hypothesis.type, hypothesisDirection, status, basis };
}

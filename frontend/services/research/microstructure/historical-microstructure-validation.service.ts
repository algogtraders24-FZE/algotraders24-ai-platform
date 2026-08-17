// services/research/microstructure/historical-microstructure-validation.service.ts
// Sprint D2.8.14 - Historical Microstructure Outcome Validation. RESEARCH
// ONLY. The orchestrator: joins real historical microstructure evidence
// (historical-microstructure-dataset.service.ts) with real forward outcomes
// (historical-outcome-evaluation.service.ts), runs a leakage audit, groups
// by D2.8.11's own MicrostructureEvidenceStatus, computes group statistics
// and significance tests, and produces exactly one of the six final
// classifications this sprint's brief requires - never vague language, and
// never a manufactured significance from an undersized sample.
import { mean, median, cohensD, welchConfidenceInterval95, bootstrapConfidenceInterval95 } from "@/lib/research/stats";
import { FORWARD_WINDOWS_CANDLES, HistoricalOutcomeEvaluationService } from "./historical-outcome-evaluation.service";
import { HistoricalMicrostructureDatasetService } from "./historical-microstructure-dataset.service";
import type { MarketSymbol } from "@/types/market";
import type { MicrostructureEvidenceStatus } from "@/types/microstructure-evidence-assessment";
import {
  MIN_GROUP_SAMPLE,
  type HistoricalMicrostructureObservation,
  type EvaluatedObservation,
  type GroupStatistics,
  type GroupComparison,
  type LeakageFinding,
  type RegimeBreakdownEntry,
  type ChronologicalSplitResult,
  type DataSourceAuditEntry,
  type HistoricalMicrostructureValidationResult,
  type ResearchFinalClassification,
  HISTORICAL_MICROSTRUCTURE_RESEARCH_VERSION,
} from "@/types/research/historical-microstructure-research";

const STATUSES: MicrostructureEvidenceStatus[] = ["confirms", "contradicts", "neutral", "insufficient_evidence"];
/** Chronological split requires enough resolved observations on BOTH sides to mean anything - twice the single-group minimum, a conservative, documented bar fixed before any split is attempted. */
const MIN_FOR_CHRONOLOGICAL_SPLIT = MIN_GROUP_SAMPLE * 2;

export class HistoricalMicrostructureValidationService {
  constructor(
    private readonly datasetService: HistoricalMicrostructureDatasetService = new HistoricalMicrostructureDatasetService(),
    private readonly outcomeService?: HistoricalOutcomeEvaluationService,
  ) {}

  async run(symbols: MarketSymbol[], asOfMs: number, dataSourceAudit: DataSourceAuditEntry[]): Promise<HistoricalMicrostructureValidationResult> {
    if (!this.outcomeService) {
      throw new Error("HistoricalMicrostructureValidationService requires an outcomeService (inject a real TimeSeriesProvider-backed instance)");
    }
    const generatedAt = new Date(asOfMs).toISOString();
    const { observations, rejected, runsConsidered } = await this.datasetService.buildObservations(symbols, asOfMs);
    const rejectionReasons: Record<string, number> = {};
    for (const [reason, count] of Object.entries(rejected)) rejectionReasons[reason] = count ?? 0;
    const observationsRejected = Object.values(rejectionReasons).reduce((sum, c) => sum + c, 0);

    if (observations.length === 0) {
      return this.emptyResult(generatedAt, dataSourceAudit, symbols, runsConsidered, observationsRejected, rejectionReasons, "DATA_UNAVAILABLE", "No usable historical microstructure observation could be built - either no real hypotheses exist for these symbols, or real historical Binance aggTrades could not be retrieved for any of them. Stopping honestly rather than fabricating a dataset.");
    }

    const { deduped, duplicatesRemoved, leakageFindings } = this.auditAndDedupe(observations, asOfMs);

    const evaluated: EvaluatedObservation[] = [];
    for (const obs of deduped) {
      const { outcomes, unavailableReasons } = await this.outcomeService.evaluateObservation(obs);
      evaluated.push({ ...obs, outcomes, unavailableReasons });
    }
    leakageFindings.push(...this.auditForwardLeakage(evaluated));

    const groupCounts = STATUSES.reduce(
      (acc, s) => ({ ...acc, [s]: evaluated.filter((o) => o.evidence.status === s).length }),
      {} as Record<MicrostructureEvidenceStatus, number>,
    );

    const groupStatisticsByWindow: Record<number, GroupStatistics[]> = {};
    for (const w of FORWARD_WINDOWS_CANDLES) {
      groupStatisticsByWindow[w] = STATUSES.map((status) => this.computeGroupStatistics(evaluated, status, w));
    }

    const comparisons: GroupComparison[] = [];
    for (const w of FORWARD_WINDOWS_CANDLES) {
      comparisons.push(this.compareGroups(evaluated, "confirms", "contradicts", w));
      comparisons.push(this.compareGroups(evaluated, "confirms", "neutral", w));
    }

    const regimeBreakdown = this.buildRegimeBreakdown(evaluated);
    const chronologicalSplit = this.buildChronologicalSplit(evaluated);

    const timestamps = observations.map((o) => o.observedAt).sort();
    const { finalClassification, classificationRationale } = this.classify(comparisons, chronologicalSplit, observations.length);

    return {
      generatedAt,
      version: HISTORICAL_MICROSTRUCTURE_RESEARCH_VERSION,
      dataSourceAudit,
      symbols,
      dateRange: timestamps.length > 0 ? { earliest: timestamps[0], latest: timestamps[timestamps.length - 1] } : undefined,
      observationsConsidered: runsConsidered,
      observationsUsable: evaluated.length,
      observationsRejected,
      rejectionReasons,
      duplicatesRemoved,
      leakageFindings,
      groupCounts,
      groupStatisticsByWindow,
      comparisons,
      regimeBreakdown,
      chronologicalSplit,
      finalClassification,
      classificationRationale,
    };
  }

  private emptyResult(
    generatedAt: string,
    dataSourceAudit: DataSourceAuditEntry[],
    symbols: MarketSymbol[],
    runsConsidered: number,
    observationsRejected: number,
    rejectionReasons: Record<string, number>,
    finalClassification: ResearchFinalClassification,
    classificationRationale: string,
  ): HistoricalMicrostructureValidationResult {
    return {
      generatedAt,
      version: HISTORICAL_MICROSTRUCTURE_RESEARCH_VERSION,
      dataSourceAudit,
      symbols,
      dateRange: undefined,
      observationsConsidered: runsConsidered,
      observationsUsable: 0,
      observationsRejected,
      rejectionReasons,
      duplicatesRemoved: 0,
      leakageFindings: [],
      groupCounts: { confirms: 0, contradicts: 0, neutral: 0, insufficient_evidence: 0 },
      groupStatisticsByWindow: {},
      comparisons: [],
      regimeBreakdown: [],
      chronologicalSplit: { status: "VALIDATION_NOT_READY", trainCount: 0, testCount: 0, detail: "No observations available." },
      finalClassification,
      classificationRationale,
    };
  }

  private auditAndDedupe(
    observations: HistoricalMicrostructureObservation[],
    asOfMs: number,
  ): { deduped: HistoricalMicrostructureObservation[]; duplicatesRemoved: number; leakageFindings: LeakageFinding[] } {
    const findings: LeakageFinding[] = [];
    const seen = new Set<string>();
    const deduped: HistoricalMicrostructureObservation[] = [];
    const dupIds: string[] = [];
    const futureIds: string[] = [];
    const providerMixIds: string[] = [];
    const tzMismatchIds: string[] = [];
    const snapshotKeySeen = new Map<string, string[]>();
    const hypothesisIdToRuns = new Map<string, Set<string>>();

    for (const obs of observations) {
      const key = `${obs.analysisRunId}:${obs.hypothesisId}`;
      if (seen.has(key)) {
        dupIds.push(key);
        continue;
      }
      seen.add(key);

      if (new Date(obs.observedAt).getTime() > asOfMs) futureIds.push(key);
      if (obs.provider !== "binance") providerMixIds.push(key);
      if (Number.isNaN(Date.parse(obs.observedAt)) || !obs.observedAt.endsWith("Z")) tzMismatchIds.push(key);

      // Keyed by (symbol, snapshot timestamp) -> the set of DISTINCT
      // analysisRunIds that used it. Multiple hypotheses from the SAME
      // analysis run legitimately and correctly share one microstructure
      // snapshot (they were generated from the same market read) - that is
      // normal, not leakage. Only genuine reuse ACROSS different runs
      // would indicate a real staleness problem (the same historical
      // reading being recycled for what should be temporally distinct
      // observations).
      const snapKey = `${obs.symbol}:${obs.snapshot.timestamp}`;
      const runsForSnap = snapshotKeySeen.get(snapKey) ?? [];
      if (!runsForSnap.includes(obs.analysisRunId)) runsForSnap.push(obs.analysisRunId);
      snapshotKeySeen.set(snapKey, runsForSnap);

      const runsForHyp = hypothesisIdToRuns.get(obs.hypothesisId) ?? new Set<string>();
      runsForHyp.add(obs.analysisRunId);
      hypothesisIdToRuns.set(obs.hypothesisId, runsForHyp);

      deduped.push(obs);
    }

    if (dupIds.length > 0) {
      findings.push({ type: "duplicate-observation", description: `${dupIds.length} observation(s) shared an identical (analysisRunId, hypothesisId) pair - removed, keeping the first.`, affectedIds: dupIds });
    }
    if (futureIds.length > 0) {
      findings.push({ type: "future-timestamp", description: `${futureIds.length} observation(s) had an observedAt timestamp after this research run's own asOf boundary - excluded from analysis (structural safeguard; none expected in a normal run).`, affectedIds: futureIds });
    }
    if (providerMixIds.length > 0) {
      findings.push({ type: "provider-mixing", description: `${providerMixIds.length} observation(s) carried a provider other than "binance" - this research only evaluates Binance venue evidence and never merges across venues.`, affectedIds: providerMixIds });
    }
    if (tzMismatchIds.length > 0) {
      findings.push({ type: "timezone-mismatch", description: `${tzMismatchIds.length} observation(s) had a malformed or non-UTC observedAt timestamp.`, affectedIds: tzMismatchIds });
    }
    const staleReuseIds = [...snapshotKeySeen.values()].filter((runIds) => runIds.length > 1).flat();
    if (staleReuseIds.length > 0) {
      findings.push({ type: "stale-snapshot-reuse", description: `${staleReuseIds.length} distinct analysisRunId(s) reused the identical (symbol, snapshot timestamp) pair across DIFFERENT runs (never merely different hypotheses within the same run, which legitimately share one snapshot).`, affectedIds: staleReuseIds });
    }
    const crossRunDupHyp = [...hypothesisIdToRuns.entries()].filter(([, runs]) => runs.size > 1).map(([id]) => id);
    if (crossRunDupHyp.length > 0) {
      findings.push({ type: "duplicate-hypothesis-id", description: `${crossRunDupHyp.length} hypothesis ID(s) appeared under more than one analysisRunId.`, affectedIds: crossRunDupHyp });
    }

    return { deduped, duplicatesRemoved: dupIds.length, leakageFindings: findings };
  }

  private auditForwardLeakage(evaluated: EvaluatedObservation[]): LeakageFinding[] {
    const badIds: string[] = [];
    for (const o of evaluated) {
      for (const w of FORWARD_WINDOWS_CANDLES) {
        const outcome = o.outcomes[w];
        if (outcome && new Date(outcome.evaluationTimestamp).getTime() <= new Date(o.observedAt).getTime()) {
          badIds.push(`${o.analysisRunId}:${o.hypothesisId}:w${w}`);
        }
      }
    }
    return badIds.length > 0
      ? [{ type: "look-ahead-bias" as const, description: `${badIds.length} forward-outcome evaluation(s) used a candle at or before the observation's own timestamp.`, affectedIds: badIds }]
      : [];
  }

  private signedReturns(evaluated: EvaluatedObservation[], status: MicrostructureEvidenceStatus, window: number): number[] {
    return evaluated
      .filter((o) => o.evidence.status === status && o.outcomes[window] && o.hypothesisDirection !== "neutral")
      .map((o) => (o.hypothesisDirection === "bullish" ? o.outcomes[window]!.forwardReturnPct : -o.outcomes[window]!.forwardReturnPct));
  }

  private computeGroupStatistics(evaluated: EvaluatedObservation[], status: MicrostructureEvidenceStatus, window: number): GroupStatistics {
    const inGroup = evaluated.filter((o) => o.evidence.status === status && o.outcomes[window]);
    const sampleCount = inGroup.length;
    if (sampleCount === 0) {
      return { group: status, windowCandles: window, sampleCount: 0, winCount: 0, lossCount: 0, inconclusiveCount: 0 };
    }

    let winCount = 0;
    let lossCount = 0;
    let inconclusiveCount = 0;
    const returns: number[] = [];
    const mfes: number[] = [];
    const maes: number[] = [];
    for (const o of inGroup) {
      const outcome = o.outcomes[window]!;
      if (outcome.directionalOutcome === "positive") winCount += 1;
      else if (outcome.directionalOutcome === "negative") lossCount += 1;
      else inconclusiveCount += 1;
      returns.push(o.hypothesisDirection === "bullish" ? outcome.forwardReturnPct : -outcome.forwardReturnPct);
      mfes.push(outcome.maximumFavorableExcursionPct);
      maes.push(outcome.maximumAdverseExcursionPct);
    }
    // Same "resolved-only denominator" convention historical-validation.service.ts
    // (D2.5.4, MIN_HISTORICAL_VALIDATION_SAMPLE) already established -
    // inconclusive carries zero directional evidence, so it's excluded
    // from the win/loss rate denominator but still reported.
    const resolved = winCount + lossCount;
    return {
      group: status,
      windowCandles: window,
      sampleCount,
      winCount,
      lossCount,
      inconclusiveCount,
      winRate: resolved > 0 ? winCount / resolved : undefined,
      lossRate: resolved > 0 ? lossCount / resolved : undefined,
      inconclusiveRate: sampleCount > 0 ? inconclusiveCount / sampleCount : undefined,
      avgForwardReturnPct: mean(returns),
      medianForwardReturnPct: median(returns),
      avgMFEPct: mean(mfes),
      medianMFEPct: median(mfes),
      avgMAEPct: mean(maes),
      medianMAEPct: median(maes),
    };
  }

  private compareGroups(evaluated: EvaluatedObservation[], groupA: MicrostructureEvidenceStatus, groupB: MicrostructureEvidenceStatus, window: number): GroupComparison {
    const returnsA = this.signedReturns(evaluated, groupA, window);
    const returnsB = this.signedReturns(evaluated, groupB, window);
    if (returnsA.length < MIN_GROUP_SAMPLE || returnsB.length < MIN_GROUP_SAMPLE) {
      return { groupA, groupB, windowCandles: window, sampleSizeA: returnsA.length, sampleSizeB: returnsB.length, status: "INSUFFICIENT_SAMPLE" };
    }
    const bootstrapCI95 = bootstrapConfidenceInterval95(returnsA, returnsB);
    return {
      groupA,
      groupB,
      windowCandles: window,
      sampleSizeA: returnsA.length,
      sampleSizeB: returnsB.length,
      status: "COMPARED",
      meanDifferencePct: mean(returnsA) - mean(returnsB),
      medianDifferencePct: median(returnsA) - median(returnsB),
      effectSize: cohensD(returnsA, returnsB),
      confidenceInterval95: welchConfidenceInterval95(returnsA, returnsB),
      bootstrapCI95,
      significant: bootstrapCI95 ? !(bootstrapCI95[0] <= 0 && bootstrapCI95[1] >= 0) : undefined,
    };
  }

  private buildRegimeBreakdown(evaluated: EvaluatedObservation[]): RegimeBreakdownEntry[] {
    const entries: RegimeBreakdownEntry[] = [];
    const bySegment = (segment: string, valueFn: (o: EvaluatedObservation) => string | undefined) => {
      const groups = new Map<string, EvaluatedObservation[]>();
      for (const o of evaluated) {
        const v = valueFn(o);
        if (!v) continue;
        groups.set(v, [...(groups.get(v) ?? []), o]);
      }
      for (const [segmentValue, obsInSegment] of groups) {
        // Phase 8's own explicit rule: never over-segment tiny samples.
        if (obsInSegment.length < MIN_GROUP_SAMPLE) continue;
        for (const w of FORWARD_WINDOWS_CANDLES) {
          const stats = STATUSES.map((s) => this.computeGroupStatistics(obsInSegment, s, w)).filter((s) => s.sampleCount > 0);
          if (stats.length > 0) entries.push({ segment, segmentValue, windowCandles: w, groups: stats });
        }
      }
    };
    bySegment("regimeType", (o) => o.regimeType);
    bySegment("volatilityBand", (o) => o.volatilityBand);
    bySegment("symbol", (o) => o.symbol);
    return entries;
  }

  private buildChronologicalSplit(evaluated: EvaluatedObservation[]): ChronologicalSplitResult {
    const resolved = evaluated.filter((o) => Object.keys(o.outcomes).length > 0);
    if (resolved.length < MIN_FOR_CHRONOLOGICAL_SPLIT) {
      return {
        status: "VALIDATION_NOT_READY",
        trainCount: 0,
        testCount: 0,
        detail: `Only ${resolved.length} observation(s) have any real forward outcome - at least ${MIN_FOR_CHRONOLOGICAL_SPLIT} are required before a chronological train/test split is meaningful.`,
      };
    }
    const sorted = [...resolved].sort((a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime());
    const splitIdx = Math.floor(sorted.length * 0.7);
    return {
      status: "SPLIT",
      trainCount: splitIdx,
      testCount: sorted.length - splitIdx,
      splitTimestamp: sorted[splitIdx].observedAt,
      detail: `Chronological 70/30 split (never randomly shuffled) at ${sorted[splitIdx].observedAt}.`,
    };
  }

  private classify(comparisons: GroupComparison[], split: ChronologicalSplitResult, totalObservations: number): { finalClassification: ResearchFinalClassification; classificationRationale: string } {
    if (totalObservations === 0) {
      return { finalClassification: "DATA_UNAVAILABLE", classificationRationale: "No historical microstructure observations could be built at all." };
    }
    const compared = comparisons.filter((c) => c.status === "COMPARED");
    if (compared.length === 0) {
      return {
        finalClassification: "INSUFFICIENT_SAMPLE",
        classificationRationale: `Every group comparison (CONFIRMS vs CONTRADICTS, CONFIRMS vs NEUTRAL) across all ${FORWARD_WINDOWS_CANDLES.length} forward windows had fewer than ${MIN_GROUP_SAMPLE} resolved, direction-adjusted observations in at least one group - no comparison could be honestly made without manufacturing significance from an undersized sample.`,
      };
    }
    if (split.status === "VALIDATION_NOT_READY") {
      return {
        finalClassification: "VALIDATION_NOT_READY",
        classificationRationale: `Group comparisons were computable, but a chronological out-of-sample split was not (${split.detail}) - declaring an edge without out-of-sample confirmation would risk reporting an in-sample artifact as a real finding.`,
      };
    }
    const significantResults = compared.filter((c) => c.significant === true);
    const significantPositiveConfirms = significantResults.filter((c) => c.groupA === "confirms" && (c.meanDifferencePct ?? 0) > 0);
    if (significantResults.length === 0) {
      return {
        finalClassification: "EDGE_NOT_SUPPORTED",
        classificationRationale: `${compared.length} comparison(s) had sufficient sample size, but none showed a bootstrap 95% CI excluding zero - no measurable predictive value was found in this dataset.`,
      };
    }
    if (significantPositiveConfirms.length === significantResults.length && significantResults.length === compared.length) {
      return {
        finalClassification: "EDGE_SUPPORTED",
        classificationRationale: `All ${compared.length} sufficiently-sampled comparison(s) showed CONFIRMS outperforming with a bootstrap 95% CI excluding zero.`,
      };
    }
    return {
      finalClassification: "REGIME_DEPENDENT",
      classificationRationale: `${significantResults.length} of ${compared.length} sufficiently-sampled comparison(s) showed a significant effect, but not consistently across every window/comparison - see regimeBreakdown for the segment-level detail rather than a single aggregate verdict.`,
    };
  }
}

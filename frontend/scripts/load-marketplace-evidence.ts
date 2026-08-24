// scripts/load-marketplace-evidence.ts
// Sprint M12 branding follow-on - Phase 2 of the evidence-discovery
// generalization. Replaces the two flat-file assembly scripts
// (assemble-marketplace-evidence-snapshot.ts, assemble-marketplace-
// evidence-content.ts) with one script that writes directly to the real
// MarketplaceEvidenceRecord table instead of JSON files - no more file-
// tracing risk (see next.config.ts's own comment on the bug this class of
// problem already caused once), one source of truth for both discovery
// (mt5EvidenceAdapter.ts) and the detail page (MarketplaceCatalogue.ts).
//
// Still run only by an AT24 human after the real M2-M7 engines finish -
// this is a storage change, not an automation change. No new computation
// happens here, every value is reshaped from files already on disk.
//
// Sprint M12 branding follow-on (observation persistence) - after every
// upsert, records a real MarketplaceObservation row for this exact
// (tradingSystemId, versionId, evidenceId, riskAnalysisId) combination -
// the @@unique constraint means re-loading the same computation twice
// never double-counts; only a genuinely new evidenceId/riskAnalysisId
// (a real re-verification at a real later point in time) adds a new real
// observation. Once real distinct observations reach M7's own
// MIN_OBSERVATIONS_FOR_VALIDATED (2) AND the underlying validation/risk
// status independently still qualify, this upgrades trustState to
// VALIDATED - mirroring trust_status_engine.py's derive_trust_status
// precedence exactly (see that function's own comment for why Python
// itself can never persist this count on its own). If the count is under
// 2, or validation/risk don't qualify, this changes nothing - whatever
// Python's own run_trust_status already decided stays as-is.
const MIN_OBSERVATIONS_FOR_VALIDATED = 2; // must match trust_status_engine.py's own constant exactly

// Usage: npx tsx scripts/load-marketplace-evidence.ts <evidence-package.json> <chain-result.json>
import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "../lib/prisma";

async function main() {
  const [evidencePath, chainPath] = process.argv.slice(2);
  if (!evidencePath || !chainPath) {
    console.error("Usage: npx tsx scripts/load-marketplace-evidence.ts <evidence-package.json> <chain-result.json>");
    process.exit(1);
  }

  const pkg = JSON.parse(readFileSync(evidencePath, "utf-8"));
  const ev = pkg.evidence;
  const chain = JSON.parse(readFileSync(chainPath, "utf-8"));

  const evidenceContent = {
    evidenceId: chain.evidenceId,
    sourceAdapter: ev.sourceAdapter ?? null,
    evidenceClass: ev.evidenceClass ?? null,
    tradeCount: ev.metricsSummary?.tradeCount ?? null,
    periodStart: ev.provenance?.periodStart ?? null,
    periodEnd: ev.provenance?.periodEnd ?? null,
    symbol: ev.provenance?.symbol ?? null,
    timeframe: ev.provenance?.timeframe ?? null,
    broker: ev.provenance?.broker ?? null,
    netProfit: ev.metricsSummary?.netProfit ?? null,
    profitFactor: ev.metricsSummary?.profitFactor ?? null,
    winRate: ev.metricsSummary?.winRate ?? null,
    maxDrawdownPercent: ev.metricsSummary?.maxDrawdown?.percent ?? null,
    totalCost: chain.m5_full?.costRisk?.totalCost ?? null,
    dataSource: ev.provenance?.dataSource?.reportFile ?? null,
    generator: ev.generatedBy ?? null,
  };

  const validationContent = {
    validationId: chain.validationId,
    overallStatus: chain.m4.overallStatus,
    methodologyVersion: chain.m4_full?.methodologyVersion ?? null,
    dimensions: (chain.m4_full?.records ?? []).map((r: { validationType: string; status: string }) => ({
      validationType: r.validationType,
      status: r.status,
    })),
  };

  const m5 = chain.m5_full;
  const riskContent = {
    riskAnalysisId: chain.m5.riskAnalysisId,
    status: chain.m5.status,
    maxDrawdownPercent: m5?.drawdown?.maxDrawdownPercent ?? null,
    maxConsecutiveLosses: m5?.lossStreaks?.maxConsecutiveLosses ?? null,
    lossClusteredSharePct: m5?.lossDistribution?.clusteredLossShare ?? null,
    recoveryEpisodes: m5?.recovery?.recoveryEpisodes ?? null,
    expectancyPerTrade: m5?.expectancy?.expectancyPerTrade ?? null,
    profitFactor: m5?.expectancy?.profitFactorNet ?? null,
    totalCost: m5?.costRisk?.totalCost ?? null,
    maxSimultaneousPositions: m5?.exposureRisk?.simultaneousExposure?.maxSimultaneousPositions ?? null,
    dataQuality: m5?.dataQuality ?? {},
  };

  const m6 = (chain.m6_full ?? []) as { eventType: string; observedAt: string; recordedAt: string }[];
  const historyContent = {
    events: m6.map((e) => ({ eventType: e.eventType, observedAt: e.observedAt, recordedAt: e.recordedAt })),
    observationCount: m6.filter((e) => e.eventType === "EVIDENCE_ADDED").length,
    singleObservationOnly: m6.filter((e) => e.eventType === "EVIDENCE_ADDED").length < 2,
  };

  const baseFields = {
    evidenceId: chain.evidenceId,
    evidenceHash: chain.evidenceHash,
    validationId: chain.validationId,
    validationHash: chain.validationHash ?? chain.evidenceId,
    riskAnalysisId: chain.m5.riskAnalysisId,
    riskAnalysisHash: chain.m5.riskAnalysisHash,
    trustState: chain.m7.status as string,
    trustReasonCode: chain.m7.reasonCode as string,
    trustExplanation: chain.m7.explanation as string,
    trustStatusId: chain.trustStatusId,
    lastEvidenceAt: chain.lastEvidenceAt ? new Date(chain.lastEvidenceAt) : null,
    validationOverallStatus: chain.m4.overallStatus as string,
    riskStatus: chain.m5.status as string,
    evidenceContent,
    validationContent,
    riskContent,
    historyContent,
  };

  const row = await prisma.marketplaceEvidenceRecord.upsert({
    where: { tradingSystemId_versionId: { tradingSystemId: chain.tradingSystemId, versionId: chain.versionId } },
    create: { tradingSystemId: chain.tradingSystemId, versionId: chain.versionId, ...baseFields },
    update: baseFields,
  });
  console.log(`Upserted marketplace_evidence_records row for ${chain.tradingSystemId} / ${chain.versionId} (id=${row.id})`);

  // Real observation persistence - see this file's own top-of-file comment.
  await prisma.marketplaceObservation
    .create({
      data: { tradingSystemId: chain.tradingSystemId, versionId: chain.versionId, evidenceId: chain.evidenceId, riskAnalysisId: chain.m5.riskAnalysisId },
    })
    .then(() => console.log("Recorded a new real observation (genuinely new evidenceId/riskAnalysisId for this version)."))
    .catch((err: { code?: string }) => {
      if (err.code === "P2002") {
        console.log("This exact evidenceId/riskAnalysisId was already observed - not double-counted (re-running the same computation is not a new observation).");
      } else {
        throw err;
      }
    });

  const observationCount = await prisma.marketplaceObservation.count({
    where: { tradingSystemId: chain.tradingSystemId, versionId: chain.versionId },
  });
  console.log(`Real distinct observations recorded for this version: ${observationCount}`);

  const validationQualifies = row.validationOverallStatus === "PASS" || row.validationOverallStatus === "WARNING";
  const riskQualifies = row.riskStatus === "COMPLETE";
  const notInvalidated = row.trustState !== "INVALIDATED" && row.trustState !== "SUPERSEDED";

  if (observationCount >= MIN_OBSERVATIONS_FOR_VALIDATED && validationQualifies && riskQualifies && notInvalidated && row.trustState !== "VALIDATED") {
    const explanation = `Evidence integrity is verified, Validation (M4) supports it (overallStatus=${row.validationOverallStatus}), RiskAnalysis (M5) is COMPLETE, and ${observationCount} independent historical observations have been recorded.`;
    await prisma.marketplaceEvidenceRecord.update({
      where: { tradingSystemId_versionId: { tradingSystemId: chain.tradingSystemId, versionId: chain.versionId } },
      data: { trustState: "VALIDATED", trustReasonCode: "VALIDATION_COMPLETE", trustExplanation: explanation },
    });
    console.log(`Trust State upgraded to VALIDATED (${observationCount} real observations, validation/risk both sufficient).`);
  } else if (observationCount < MIN_OBSERVATIONS_FOR_VALIDATED) {
    console.log(`Trust State stays as computed (${row.trustState}) - needs ${MIN_OBSERVATIONS_FOR_VALIDATED - observationCount} more genuinely distinct observation(s) over real time to reach VALIDATED.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

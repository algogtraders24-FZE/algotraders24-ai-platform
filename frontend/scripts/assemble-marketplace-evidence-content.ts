// scripts/assemble-marketplace-evidence-content.ts
// Sprint M12 branding follow-on - the listing detail page's Evidence/
// Validation/Risk/History sections were hardcoded to null for every
// listing (MarketplaceCatalogue's own comment: "no ingestion path exists
// yet from the ea-research/ artifacts"). This script closes that gap the
// same way assemble-marketplace-evidence-snapshot.ts closed it for
// discovery: read the REAL M2 Evidence package + M3-M7 chain result an
// AT24 human already generated, reshape into the exact
// EvidenceSummary/ValidationSummary/RiskSummary/HistorySummary types
// (types/marketplace.ts), write one content file per product. No new
// computation - every number here already exists in the source files.
//
// Usage: npx tsx scripts/assemble-marketplace-evidence-content.ts <path-to-evidence-package.json> <path-to-chain-result.json>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const CONTENT_DIR = join(__dirname, "..", "data", "marketplace-evidence");

function safe(s: string): string {
  return s.replace(/[^a-zA-Z0-9.-]/g, "_");
}

function main() {
  const [evidencePath, chainPath] = process.argv.slice(2);
  if (!evidencePath || !chainPath) {
    console.error("Usage: npx tsx scripts/assemble-marketplace-evidence-content.ts <evidence-package.json> <chain-result.json>");
    process.exit(1);
  }

  const pkg = JSON.parse(readFileSync(evidencePath, "utf-8"));
  const ev = pkg.evidence;
  const chain = JSON.parse(readFileSync(chainPath, "utf-8"));

  const evidence = {
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

  const validation = {
    validationId: chain.validationId,
    overallStatus: chain.m4.overallStatus,
    methodologyVersion: chain.m4_full?.methodologyVersion ?? null,
    dimensions: (chain.m4_full?.records ?? []).map((r: { validationType: string; status: string }) => ({
      validationType: r.validationType,
      status: r.status,
    })),
  };

  const m5 = chain.m5_full;
  const risk = {
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
  const history = {
    events: m6.map((e) => ({ eventType: e.eventType, observedAt: e.observedAt, recordedAt: e.recordedAt })),
    observationCount: m6.filter((e) => e.eventType === "EVIDENCE_ADDED").length,
    singleObservationOnly: m6.filter((e) => e.eventType === "EVIDENCE_ADDED").length < 2,
  };

  mkdirSync(CONTENT_DIR, { recursive: true });
  const filename = `${safe(chain.tradingSystemId)}__${safe(chain.versionId)}.content.json`;
  const outPath = join(CONTENT_DIR, filename);
  writeFileSync(outPath, JSON.stringify({ evidence, validation, risk, history }, null, 2), "utf-8");
  console.log(`Wrote ${outPath}`);
}

main();

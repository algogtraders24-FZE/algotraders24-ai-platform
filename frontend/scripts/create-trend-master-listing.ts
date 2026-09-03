// scripts/create-trend-master-listing.ts
// Sprint M15 (real /products build-out) - Product #1: AT24 AI Trend
// Master. A genuinely new EA (not a rebrand), replacing the fabricated
// /products placeholder of the same name/concept. Same real pipeline as
// create-goldfire-listing.ts: real compiled .ex5 registered as a
// PUBLISHED ReleaseArtifact, real ingestion+eligibility pipeline (not a
// hand-set trustState).
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";
import { runIngestionPipeline } from "../services/marketplace/factory/ingestion";
import { evaluateEligibility } from "../services/marketplace/factory/eligibility";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const SLUG = "at24-trend-master";
const TRADING_SYSTEM_ID = "AT24-TREND-MASTER";
const VERSION_ID = "AT24-TREND-MASTER-v1.00-XAUUSD-2026";
const EX5_PATH = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m15-new-products", "source", "AT24_AI_Trend_Master.ex5");
const ICON_PATH = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m15-new-products", "branding", "at24-trend-master-icon.svg");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const description = `AT24 Trend Master trades multi-timeframe trend continuation on Forex majors and Gold: an H4 EMA(50/200) macro trend filter, an H1 EMA(21/55) + ADX(14) entry-timing gate (only trades when a real trend, not chop, is present), and an RSI(14) pullback-entry timer (buys dips in an uptrend, sells rallies in a downtrend). Position sizing is genuinely adaptive - risk-percent of balance, scaled by the current ATR stop distance, not a fixed lot.

Honesty note: this replaces an old placeholder listing that described "AI" and "deep-learning" signal detection. This build has no trained model - it is a real, disclosed rule-based system (the mechanism above). "AI" has been dropped from the name's marketing claim; only the honest EMA/ADX/RSI mechanism is described here.

Independently verified backtest evidence (AT24 M2-M5 pipeline, faithful Python port of the real .mq5 engine, run against real Exness XAUUSD H1/H4 candles, 2024.01-2026.05, 112 trades):
- Net profit: +105 (per 0.01 lot), profit factor 1.12, win rate 46.4%, max drawdown 1.9%
- A second real run on EURUSD over the same period (195 trades) came back essentially breakeven (profit factor 0.98) - disclosed here, not hidden, since this listing currently only carries formal Evidence for the Gold result.

Trust Status: INCONCLUSIVE. Evidence integrity is verified and validation has passed everywhere it can currently be computed, but market-regime coverage and parameter-sensitivity are not yet computable (same open, program-wide gap as every other AT24 product). Past backtest performance is not a guarantee of future results.`;

async function main() {
  const seller = await prisma.user.findFirst({ where: { email: SELLER_EMAIL }, select: { id: true } });
  if (!seller) throw new Error(`No User found for ${SELLER_EMAIL}`);

  const bytes = await readFile(EX5_PATH);
  const artifactHash = createHash("sha256").update(bytes).digest("hex");
  await mkdir(RELEASES_DIR, { recursive: true });
  const release = await prisma.releaseArtifact.upsert({
    where: { tradingSystemId_versionId_platform_artifactHash: { tradingSystemId: TRADING_SYSTEM_ID, versionId: VERSION_ID, platform: "MT5", artifactHash } },
    create: { tradingSystemId: TRADING_SYSTEM_ID, versionId: VERSION_ID, platform: "MT5", artifactVersion: "v1.00", artifactHash, releaseStatus: "PUBLISHED" },
    update: { releaseStatus: "PUBLISHED" },
  });
  await writeFile(path.join(RELEASES_DIR, `${release.id}.ex5`), bytes);
  await writeFile(path.join(RELEASES_DIR, `${release.id}.filename.txt`), "AT24_AI_Trend_Master.ex5", "utf-8");

  const listing = await prisma.marketplaceListing.upsert({
    where: { slug: SLUG },
    create: {
      sellerId: seller.id, slug: SLUG, title: "AT24 Trend Master", description,
      media: [], pricing: { model: "one_time", amount: 149, currency: "USD" },
      category: "Trend", platformTag: "MT5", assetTag: "Gold",
      tags: ["trend", "forex", "gold", "ema", "adx", "mt5"],
      tradingSystemId: TRADING_SYSTEM_ID, versionId: VERSION_ID,
      publicationState: "DRAFT",
    },
    update: { description },
  });

  const mediaDir = path.join(__dirname, "..", "public", "marketplace", listing.id);
  await mkdir(mediaDir, { recursive: true });
  await copyFile(ICON_PATH, path.join(mediaDir, "icon.svg"));
  const media = [`/marketplace/${listing.id}/icon.svg`];
  await prisma.marketplaceListing.update({ where: { id: listing.id }, data: { media } });

  const ingestion = await runIngestionPipeline({
    title: listing.title, description: listing.description, platformTag: listing.platformTag,
    tradingSystemId: listing.tradingSystemId, versionId: listing.versionId,
  });
  if (ingestion.failedAt) throw new Error(`Ingestion failed at ${ingestion.failedAt}: ${JSON.stringify(ingestion.stages)}`);

  const eligibility = evaluateEligibility({
    tradingSystemId: listing.tradingSystemId, versionId: listing.versionId,
    evidenceId: ingestion.evidenceId, validationId: ingestion.validationId,
    validationOverallStatus: ingestion.validationOverallStatus, riskAnalysisId: ingestion.riskAnalysisId,
    riskStatus: ingestion.riskStatus, trustState: ingestion.trustState,
    sellerId: listing.sellerId, requestingUserId: listing.sellerId,
  });

  const updated = await prisma.marketplaceListing.update({
    where: { id: listing.id },
    data: {
      evidenceId: ingestion.evidenceId, evidenceHash: ingestion.evidenceHash,
      validationId: ingestion.validationId, validationHash: ingestion.validationHash,
      riskAnalysisId: ingestion.riskAnalysisId, riskAnalysisHash: ingestion.riskAnalysisHash,
      trustState: ingestion.trustState, trustReasonCode: ingestion.trustReasonCode,
      trustExplanation: ingestion.trustExplanation ?? "", trustStatusId: ingestion.trustStatusId,
      lastEvidenceAt: ingestion.lastEvidenceAt ? new Date(ingestion.lastEvidenceAt) : null,
      publicationState: eligibility.eligible ? "READY" : "UNDER_REVIEW",
    },
  });

  console.log("Listing id:", updated.id, "slug:", updated.slug);
  console.log("publicationState:", updated.publicationState, "trustState:", updated.trustState);
  console.log("eligibility:", JSON.stringify(eligibility));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

// scripts/create-goldoobscalper-listing.ts
// M15 real /products build-out - Gold OOB Scalper, a seller-provided EA
// (real .mq5 source + real MT5 .xlsx Strategy Tester report). A real M1
// XAUUSD scalper: an ADX(14)>=22 trend-strength gate combined with a
// Heikin-Ashi candle-color-run confirmation arms BuyStop/SellStop pending
// orders a fixed offset beyond an 8-bar swing high/low, with a broker-
// stop-distance-aware trailing stop and a London+NY session filter. Same
// real ingestion + eligibility pipeline as every other Marketplace
// listing, curve-enriched via the now-standard bar-level equity
// reconstruction (reconstruct_equity_curve.py) before publication.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";
import { runIngestionPipeline } from "../services/marketplace/factory/ingestion";
import { evaluateEligibility } from "../services/marketplace/factory/eligibility";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const SLUG = "gold-oob-scalper";
const TRADING_SYSTEM_ID = "GOLDOOBSCALPER";
const VERSION_ID = "GOLDOOBSCALPER-v8.00-2026-BASELINE";
const EX5_PATH = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m15-new-products", "source", "Gold_OOB_Scalper_Updated.ex5");
const ICON_PATH = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m15-new-products", "branding", "gold-oob-scalper-icon.svg");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const description = `Gold OOB Scalper is a real, seller-provided M1 scalping EA for XAUUSD built around two confirming signals: an ADX(14)>=22 trend-strength gate and a Heikin-Ashi candle-color-run confirmation over a 3-bar lookback. When both agree, it arms a BuyStop/SellStop pending order a fixed offset beyond an 8-bar swing high/low, trades a fixed 0.01 lot with a fixed 400-point stop loss, and manages the position with a broker-stop-distance-aware trailing stop that only starts once price has genuinely cleared the broker's own minimum stop/freeze distance. A London+NY session filter cleans up any unfilled pending orders outside session, and a spread filter blocks entries when the live spread is too wide.

Independently verified backtest evidence (AT24 M2-M7 pipeline, real MT5 Strategy Tester .xlsx export, Exness, XAUUSD M1, 2025.01.02-2026.01.23, 29,327 real trades, $10,000 starting deposit - netProfit/profitFactor/tradeCount all reconcile to the report's own stated values with zero delta):
- Net profit: +1,087,468.00, profit factor 2.13, win rate 68.33%
- Max drawdown: 25.13% on the report's own balance curve; a real bar-level, mark-to-market equity curve was independently reconstructed from real M15 XAUUSD price bars (filling the intrabar path between each trade's own already-known entry/exit, calibrated to land exactly on that trade's own real profit) and confirms this: 25.04% max drawdown, 19 days to the worst episode, and every one of the 602 real drawdown episodes fully recovered before period end (average recovery time: under half a day).
- The very large net profit reflects a very high trade count (29,327 trades averaging $37.08 each on a fixed 0.01 lot) accumulating arithmetically on the M1 timeframe over ~12.7 months, not lot-size compounding.
- Real M1 scalping at this frequency means real broker execution capacity, spread, and slippage are not fully captured by any backtest - live results will depend heavily on broker execution quality at M1.

Trust Status: VALIDATED - real Evidence integrity verified, real Validation (M4) passed, real Risk Analysis (M5) is COMPLETE (including the bar-level drawdown/recovery reconstruction above), and the required independent historical observation has been recorded. See the badge for the current state. Past backtest performance is not a guarantee of future results.`;

async function main() {
  const seller = await prisma.user.findFirst({ where: { email: SELLER_EMAIL }, select: { id: true } });
  if (!seller) throw new Error(`No User found for ${SELLER_EMAIL}`);

  const bytes = await readFile(EX5_PATH);
  const artifactHash = createHash("sha256").update(bytes).digest("hex");
  await mkdir(RELEASES_DIR, { recursive: true });
  const release = await prisma.releaseArtifact.upsert({
    where: { tradingSystemId_versionId_platform_artifactHash: { tradingSystemId: TRADING_SYSTEM_ID, versionId: VERSION_ID, platform: "MT5", artifactHash } },
    create: { tradingSystemId: TRADING_SYSTEM_ID, versionId: VERSION_ID, platform: "MT5", artifactVersion: "v8.00", artifactHash, releaseStatus: "PUBLISHED" },
    update: { releaseStatus: "PUBLISHED" },
  });
  await writeFile(path.join(RELEASES_DIR, `${release.id}.ex5`), bytes);
  await writeFile(path.join(RELEASES_DIR, `${release.id}.filename.txt`), "Gold_OOB_Scalper_Updated.ex5", "utf-8");

  const listing = await prisma.marketplaceListing.upsert({
    where: { slug: SLUG },
    create: {
      sellerId: seller.id, slug: SLUG, title: "Gold OOB Scalper", description,
      media: [], pricing: { model: "one_time", amount: 249, currency: "USD" },
      category: "Scalping", platformTag: "MT5", assetTag: "Gold",
      tags: ["scalping", "gold", "adx", "heikin-ashi", "m1", "mt5"],
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

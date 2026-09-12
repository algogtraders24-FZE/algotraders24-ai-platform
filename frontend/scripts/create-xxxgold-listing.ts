// scripts/create-xxxgold-listing.ts
// M15 real /products build-out - XXX Gold, a seller-provided EA (real
// .mq5 source + real MT5 .xlsx Strategy Tester report). A genuinely
// different architecture from every other MT5 EA on this marketplace:
// 5 independently-firing breakout modules on the same symbol, each with
// its own pending-order logic, sharing one trend filter and one exit
// framework (time-stop + auto-breakeven + smart trailing + a "moon-lock"
// running-peak exit). Same real ingestion + eligibility pipeline as
// every other Marketplace listing.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";
import { runIngestionPipeline } from "../services/marketplace/factory/ingestion";
import { evaluateEligibility } from "../services/marketplace/factory/eligibility";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const SLUG = "xxx-gold-multi-module-breakout";
const TRADING_SYSTEM_ID = "XXXGOLD";
const VERSION_ID = "XXXGOLD-v3.02-2026-BASELINE";
const EX5_PATH = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m15-new-products", "source", "XXXGOLD.ex5");
const ICON_PATH = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m15-new-products", "branding", "xxxgold-icon.svg");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const description = `XXX Gold is a real, seller-provided multi-module breakout EA for XAUUSD - a genuinely different architecture from every other MT5 EA on this marketplace. Instead of one entry rule, it runs 5 independently-firing breakout modules on the same symbol at once: Nova (prior daily high/low), Apex (12-bar high/low), Zenith (20-bar high/low), Pulse (an ATR-scaled offset from the last close), and Eclipse (fractal high/low) - each placing its own pending stop order only when an H1 EMA(50/200) trend filter agrees with that direction. Every position shares the same exit framework: a 45-minute time-stop on losers, automatic breakeven, smart trailing, and a "moon-lock" exit that locks in a percentage of a position's own running peak profit. Weekend, spread, prop-firm-mode, and daily-loss shields are all real and configurable. An on-chart dashboard (timer-driven, so it updates even with no incoming ticks) shows live balance/equity/drawdown, per-module on/off state, and the last 5 trades.

Independently verified backtest evidence (AT24 M2-M5 pipeline, real MT5 Strategy Tester .xlsx export, Exness, XAUUSD M15, 2025.01.01-2026.08.08, 34,814 real trades / 69,628 real deals, $10,000 starting deposit - netProfit/profitFactor/tradeCount all reconcile to the report's own stated values with zero delta):
- Net profit: +1,104,261.90, profit factor 3.11, win rate 87.68%
- Max drawdown: 12.99% - genuinely low relative to the return, and NOT a lot-size-compounding story: every module trades a fixed 0.01 lot. The very large net profit comes from a very high trade count (34,814 trades averaging $31.72 each) accumulating arithmetically over ~19 months, not from growing position sizes.
- The seller's report filename ("5setfile.xlsx") implies this may be one of several parameter/set-file variants tested - only this one variant's report was provided, so no claim is made about how any other implied variant performed.
- Running 5 concurrent breakout modules on one symbol means real, elevated trade frequency and simultaneous open positions - real broker execution capacity, spread, and slippage at this frequency are not fully captured by any backtest.

Trust Status: INCONCLUSIVE at ingestion, resolved to LIMITED after real risk analysis - see the badge for the current state. Real infrastructure fixes were needed and made to correctly process this Evidence: the standard duplicate-trade check and deal-to-trade reconciliation both assumed at most one open position per symbol at a time, which does not hold for a 5-module concurrent system - both were corrected using real, distinct MT5 deal identifiers rather than row order, disclosed in full in this listing's version registry entry. Past backtest performance is not a guarantee of future results.`;

async function main() {
  const seller = await prisma.user.findFirst({ where: { email: SELLER_EMAIL }, select: { id: true } });
  if (!seller) throw new Error(`No User found for ${SELLER_EMAIL}`);

  const bytes = await readFile(EX5_PATH);
  const artifactHash = createHash("sha256").update(bytes).digest("hex");
  await mkdir(RELEASES_DIR, { recursive: true });
  const release = await prisma.releaseArtifact.upsert({
    where: { tradingSystemId_versionId_platform_artifactHash: { tradingSystemId: TRADING_SYSTEM_ID, versionId: VERSION_ID, platform: "MT5", artifactHash } },
    create: { tradingSystemId: TRADING_SYSTEM_ID, versionId: VERSION_ID, platform: "MT5", artifactVersion: "v3.02", artifactHash, releaseStatus: "PUBLISHED" },
    update: { releaseStatus: "PUBLISHED" },
  });
  await writeFile(path.join(RELEASES_DIR, `${release.id}.ex5`), bytes);
  await writeFile(path.join(RELEASES_DIR, `${release.id}.filename.txt`), "XXXGOLD.ex5", "utf-8");

  const listing = await prisma.marketplaceListing.upsert({
    where: { slug: SLUG },
    create: {
      sellerId: seller.id, slug: SLUG, title: "XXX Gold - Multi-Module Breakout", description,
      media: [], pricing: { model: "one_time", amount: 299, currency: "USD" },
      category: "Breakout", platformTag: "MT5", assetTag: "Gold",
      tags: ["breakout", "gold", "multi-strategy", "dashboard", "mt5"],
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

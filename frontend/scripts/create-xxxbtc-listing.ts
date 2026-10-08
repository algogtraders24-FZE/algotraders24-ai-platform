// scripts/create-xxxbtc-listing.ts
// XXX BTC - seller-provided 5-module 24/7 breakout EA for Bitcoin (BTCUSD) with an optional seller-supplied
// ONNX entry filter. Real .mq5 + real MT5 .xlsx Strategy Tester report, processed through the real M2-M7 chain
// (ea-research/marketplace-research/m15-new-products/generate_xxxbtc_chain.py, with the real bar-level
// equity curve from BTCUSD M15 candles). Same ingestion + eligibility pipeline as every other listing; the Trust
// State shown is whatever the chain produced - nothing is set by hand.
//
// Run order: (1) python generate_xxxbtc_chain.py  (2) npx tsx scripts/load-marketplace-evidence.ts <evidence> <chain>
//            (3) python build_xxxbtc_bundle.py <hdr dump>  (4) npx tsx scripts/create-xxxbtc-listing.ts
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile, rm } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";
import { runIngestionPipeline } from "../services/marketplace/factory/ingestion";
import { evaluateEligibility } from "../services/marketplace/factory/eligibility";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const SLUG = "xxx-btc-multi-module-breakout";
const TRADING_SYSTEM_ID = "XXXBTC";
const VERSION_ID = "XXXBTC-v1.00-2025-2026-BASELINE";
const PRICE_USD = 299;
const M15 = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m15-new-products");
const ZIP_PATH = path.join(M15, "source", "XXXBTC_v1.00.zip");
const ICON_PATH = path.join(M15, "branding", "xxxbtc-icon.svg");
const BANNER_PATH = path.join(M15, "branding", "xxxbtc-banner.svg");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const description = `XXX BTC is a seller-provided multi-module breakout EA for Bitcoin (BTCUSD) on the M15 chart, built for 24/7 crypto trading. Instead of one entry rule it runs 5 independent breakout modules at once - Nova (prior daily high/low), Apex (12-bar high/low), Zenith (20-bar high/low), Pulse (an ATR-scaled offset from the last close) and Eclipse (fractal high/low) - each placing its own pending stop order. Two optional gates can be switched on: an H1 EMA 50/200 trend filter and an ONNX AI filter that scores each setup (default threshold 0.80). Every position shares one exit framework: a 60-minute time-stop on losers, automatic breakeven, smart trailing and a "moon-lock" exit that protects a percentage of a position's own running peak profit. Spread, prop-firm-mode and daily-loss shields are built in (the weekend shield is off by default because crypto trades all week), and an on-chart dashboard shows balance/equity/drawdown, per-module state, AI status and the last 5 trades. The download contains the compiled EA, the ONNX model files, the exact input set used in the backtest and an install guide.

AT24-computed evidence (real MT5 Strategy Tester .xlsx export, Exness BTCUSD, M15, 2025-01-01 to 2026-08-07, 110,545 trades; net profit, profit factor and trade count reconcile to the report's own stated values with zero delta; drawdown and recovery use a real M15 bar-level equity curve built from real BTCUSD M15 candles). All amounts below are exactly as printed in the seller's report, which states its currency as "profit in pips" - check the money value of a trade on your own broker/account before relying on any figure:
- Net profit 12,767,123.2, profit factor 6.03, win rate 79.4%, average trade +115.49, largest win +1,740.7, largest loss -1,852.5, longest losing streak 24 trades.
- Maximum drawdown 16,487.9 on the reconstructed equity curve (the report's own maximal drawdown line states 11,973.3).
- The result is NOT evenly spread over time: 2025 made 11,251,668.9 while 2026 (Jan to 7 Aug) made 1,515,454.3 - roughly a fifth of the 2025 monthly pace - and the longest losing streak (24) and the larger drawdown both happened in 2026. Every month in the test is profitable, which is unusual and worth treating with caution.
- Position profile: up to 9 positions open at the same time, 50% long / 50% short.

Read before buying
- The tested settings are NOT the EA defaults: the run used the H1 trend filter OFF and the ONNX AI filter ON, with a fixed 0.10 lot on a 10,000 deposit. The EA's own defaults are trend filter ON, ONNX OFF, 0.01 lot. The download includes the tested input set as a .set file. Profit and drawdown scale with lot size.
- Broker points: stop loss, take profit and the other distances are in the symbol's POINTS. On Exness BTCUSD (point 0.01) the default 1000-point stop is a 10.00 price move and the 3000-point take profit a 30.00 move. Re-scale before trading on a different broker.
- The ONNX model file is supplied by the seller; its training data and training window are not disclosed, so overlap with the backtest period cannot be ruled out. If the model file is missing the EA falls back to trading without the filter.
- The backtest report was generated on 13 Sep 2026; the EA source was last saved earlier the same day (before the report) and the delivered compiled file is dated 14 Sep 2026. The seller states the logic is unchanged.
- History quality of the run was only 37% real ticks. Several statistics (Sharpe ratio 59.8, recovery factor 1,061, maximum drawdown 0.10% in the report) are far outside what live trading produces, which points to idealised tester fills; expect live results to differ materially. Commission, swap and spread model are not disclosed by the report. Regime coverage and parameter sensitivity are INCONCLUSIVE - only one parameter set and one instrument were tested.
- Pending-order breakout trading on Bitcoin is sensitive to broker stop levels, spread and slippage during fast moves. Past backtest performance is not a guarantee of future results; trading leveraged crypto CFDs is risky. Test on a demo account first.`;

async function main() {
  const seller = await prisma.user.findFirst({ where: { email: SELLER_EMAIL }, select: { id: true } });
  if (!seller) throw new Error(`No User found for ${SELLER_EMAIL}`);

  const bytes = await readFile(ZIP_PATH);
  const artifactHash = createHash("sha256").update(bytes).digest("hex");
  await mkdir(RELEASES_DIR, { recursive: true });
  const release = await prisma.releaseArtifact.upsert({
    where: { tradingSystemId_versionId_platform_artifactHash: { tradingSystemId: TRADING_SYSTEM_ID, versionId: VERSION_ID, platform: "MT5", artifactHash } },
    create: { tradingSystemId: TRADING_SYSTEM_ID, versionId: VERSION_ID, platform: "MT5", artifactVersion: "v1.00", artifactHash, releaseStatus: "PUBLISHED" },
    update: { releaseStatus: "PUBLISHED" },
  });
  // A changed bundle = new hash = new release row: retire superseded rows nobody holds a licence on.
  const older = await prisma.releaseArtifact.findMany({
    where: { tradingSystemId: TRADING_SYSTEM_ID, versionId: VERSION_ID, platform: "MT5", id: { not: release.id }, releaseStatus: "PUBLISHED" },
    select: { id: true },
  });
  for (const o of older) {
    if ((await prisma.license.count({ where: { releaseId: o.id } })) > 0) continue;
    await prisma.releaseArtifact.update({ where: { id: o.id }, data: { releaseStatus: "DEPRECATED" } });
    await rm(path.join(RELEASES_DIR, `${o.id}.zip`), { force: true });
    await rm(path.join(RELEASES_DIR, `${o.id}.filename.txt`), { force: true });
    console.log("Deprecated superseded release", o.id);
  }
  await writeFile(path.join(RELEASES_DIR, `${release.id}.zip`), bytes);
  await writeFile(path.join(RELEASES_DIR, `${release.id}.filename.txt`), "XXXBTC_v1.00.zip", "utf-8");

  const listing = await prisma.marketplaceListing.upsert({
    where: { slug: SLUG },
    create: {
      sellerId: seller.id, slug: SLUG, title: "XXX BTC - 24/7 Multi-Module Breakout", description,
      media: [], pricing: { model: "one_time", amount: PRICE_USD, currency: "USD" },
      category: "Breakout", platformTag: "MT5", assetTag: "BTC",
      tags: ["breakout", "btc", "bitcoin", "crypto", "24-7", "onnx", "multi-strategy", "dashboard", "mt5"],
      tradingSystemId: TRADING_SYSTEM_ID, versionId: VERSION_ID,
      publicationState: "DRAFT",
    },
    update: { description, versionId: VERSION_ID, tradingSystemId: TRADING_SYSTEM_ID },
  });

  const mediaDir = path.join(__dirname, "..", "public", "marketplace", listing.id);
  await mkdir(mediaDir, { recursive: true });
  await copyFile(ICON_PATH, path.join(mediaDir, "icon.svg"));
  await copyFile(BANNER_PATH, path.join(mediaDir, "banner.svg"));
  const media = [`/marketplace/${listing.id}/icon.svg`, `/marketplace/${listing.id}/banner.svg`];
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
      publicationState: eligibility.eligible ? "PUBLISHED" : "UNDER_REVIEW",
    },
  });

  console.log("Listing id:", updated.id, "slug:", updated.slug);
  console.log("publicationState:", updated.publicationState, "trustState:", updated.trustState);
  console.log("eligibility:", JSON.stringify(eligibility));
  console.log("Release:", release.id, "sha256", artifactHash);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

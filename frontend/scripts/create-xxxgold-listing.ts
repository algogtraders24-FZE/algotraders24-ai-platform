// scripts/create-xxxgold-listing.ts
// XXX Gold - seller-provided 5-module breakout EA for Gold (XAUUSD)
// Real .mq5 + real MT5 .xlsx Strategy Tester report, processed through the real M2-M7 chain
// (ea-research/marketplace-research/m15-new-products/rerun_xxxgold_with_curve.py, with the real bar-level
// equity curve from XAUUSD M15 candles). Same ingestion + eligibility pipeline as every other listing; the Trust
// State shown is whatever the chain produced - nothing is set by hand.
//
// Run order: (1) python rerun_xxxgold_with_curve.py  (2) npx tsx scripts/load-marketplace-evidence.ts <evidence> <chain>
//            (3) python build_xxxgold_bundle.py <hdr dump>  (4) npx tsx scripts/create-xxxgold-listing.ts
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile, rm } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";
import { runIngestionPipeline } from "../services/marketplace/factory/ingestion";
import { evaluateEligibility } from "../services/marketplace/factory/eligibility";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const SLUG = "xxx-gold-multi-module-breakout";
const TRADING_SYSTEM_ID = "XXXGOLD";
const VERSION_ID = "XXXGOLD-v3.02-2026-BASELINE";
const PRICE_USD = 299;
const M15 = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m15-new-products");
const ZIP_PATH = path.join(M15, "source", "XXXGOLD_v3.02.zip");  // v1.01 logic; AI model embedded
const ICON_PATH = path.join(M15, "branding", "xxxgold-icon.svg");
const BANNER_PATH = path.join(M15, "branding", "xxxgold-banner.svg");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const description = `XXX Gold is a seller-provided multi-module breakout EA for Gold (XAUUSD) on the M15 chart. Instead of one entry rule it runs 5 independent breakout modules at once - Nova (prior daily high/low), Apex (12-bar high/low), Zenith (20-bar high/low), Pulse (an ATR-scaled offset from the last close) and Eclipse (fractal high/low) - each placing its own pending stop order when an H1 EMA 50/200 trend filter agrees with the direction. Every position shares one exit framework: a 45-minute time-stop on losers, automatic breakeven, smart trailing and a "moon-lock" exit that protects a percentage of a position's own running peak profit. Weekend, spread, prop-firm-mode and daily-loss shields are built in, and an on-chart dashboard (timer-driven) shows balance/equity/drawdown, per-module state and the last 5 trades. The download contains the compiled EA, the exact input set used in the backtest and an install guide.

AT24-computed evidence (real MT5 Strategy Tester .xlsx export, Exness XAUUSD, M15, 2025-01-01 to 2026-08-07, 34,814 trades / 69,628 deals; net profit, profit factor and trade count reconcile to the report's own stated values with zero delta; drawdown and recovery use a real M15 bar-level equity curve built from real XAUUSD M15 candles). All amounts below are exactly as printed in the seller's report, which states its currency as "profit in pips" - check the money value of a trade on your own broker/account before relying on any figure:
- Net profit 1,104,261.9, profit factor 3.11, win rate 87.7%, average trade +31.72, longest losing streak 11 trades.
- Maximum drawdown 37,440.1 on the reconstructed equity curve = 27.4% of equity at its peak, lasting 27 days. (An earlier version of this listing quoted 12.99%, which only looked at closed trades and missed the open-position swings; that was corrected on 8 Oct 2026.)
- Lot size: the tested run used auto-lot-growth with a 0.10 cap, and on the 10,000 test deposit EVERY trade was 0.10 lot. (An earlier version of this listing wrongly said "fixed 0.01 lot"; corrected on 8 Oct 2026.) Profit and drawdown are those of a 0.10-lot run and scale with lot size.
- The result is NOT evenly spread over time: 2025 made 1,027,347.2 while 2026 (Jan to 7 Aug) made 76,914.7 - roughly a ninth of the 2025 monthly pace - and the worst month of the whole test was May 2026 (-21,510.6).
- Position profile: up to 9 positions open at the same time, 61% long / 39% short.

Read before buying
- The tested settings are NOT the EA defaults: the run used auto-lot-growth ON, a 0.10 lot cap, the daily-loss limit ON and a 12-pip break-even trigger (EA defaults: growth off, no cap, daily-loss limit off, 10-pip trigger, fixed 0.01 lot). The download includes the tested input set as a .set file.
- Stop loss, take profit, break-even and trailing are in the EA's own pip units for gold; check how they map to price on your broker's XAUUSD before trading.
- The report's file name implies it may be one of several parameter/set-file variants the seller tested; only this one variant's report was provided, so nothing is claimed about any other variant.
- History quality of the run was only 37% real ticks. A 0.10-lot gold breakout run with 5 concurrent modules is sensitive to spread, slippage and broker stop levels, which no backtest fully captures. Regime coverage and parameter sensitivity are INCONCLUSIVE - only one parameter set and one instrument were tested. Commission, swap and spread model are not disclosed by the report.
- Real processing note: the standard duplicate-trade check and deal-to-trade reconciliation assumed at most one open position per symbol at a time, which does not hold for a 5-module concurrent system; both were corrected using MT5's real per-deal identifiers (disclosed in this listing's version registry entry).
- Past backtest performance is not a guarantee of future results; trading leveraged gold CFDs is risky. Test on a demo account first.`;

async function main() {
  const seller = await prisma.user.findFirst({ where: { email: SELLER_EMAIL }, select: { id: true } });
  if (!seller) throw new Error(`No User found for ${SELLER_EMAIL}`);

  const bytes = await readFile(ZIP_PATH);
  const artifactHash = createHash("sha256").update(bytes).digest("hex");
  await mkdir(RELEASES_DIR, { recursive: true });
  const release = await prisma.releaseArtifact.upsert({
    where: { tradingSystemId_versionId_platform_artifactHash: { tradingSystemId: TRADING_SYSTEM_ID, versionId: VERSION_ID, platform: "MT5", artifactHash } },
    create: { tradingSystemId: TRADING_SYSTEM_ID, versionId: VERSION_ID, platform: "MT5", artifactVersion: "v3.02", artifactHash, releaseStatus: "PUBLISHED" },
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
  await writeFile(path.join(RELEASES_DIR, `${release.id}.filename.txt`), "XXXGOLD_v3.02.zip", "utf-8");

  const listing = await prisma.marketplaceListing.upsert({
    where: { slug: SLUG },
    create: {
      sellerId: seller.id, slug: SLUG, title: "XXX Gold - Multi-Module Breakout", description,
      media: [], pricing: { model: "one_time", amount: PRICE_USD, currency: "USD" },
      category: "Breakout", platformTag: "MT5", assetTag: "Gold",
      tags: ["breakout", "gold", "xauusd", "multi-strategy", "dashboard", "mt5"],
      tradingSystemId: TRADING_SYSTEM_ID, versionId: VERSION_ID,
      publicationState: "DRAFT",
    },
    update: { title: "XXX Gold - Multi-Module Breakout", description, pricing: { model: "one_time", amount: PRICE_USD, currency: "USD" }, versionId: VERSION_ID, tradingSystemId: TRADING_SYSTEM_ID },
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

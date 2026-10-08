// scripts/create-xxxus30-listing.ts
// XXX US30 - seller-provided 5-module breakout EA for the Dow Jones (US30) with a seller-trained ONNX
// entry filter. Real .mq5 + real MT5 .xlsx Strategy Tester report, processed through the real M2-M7 chain
// (ea-research/marketplace-research/m15-new-products/generate_xxxus30_chain.py, with the real bar-level
// equity curve from US30 M15 candles). Same ingestion + eligibility pipeline as every other listing; the Trust
// State shown is whatever the chain produced - nothing is set by hand.
//
// Run order: (1) python generate_xxxus30_chain.py  (2) npx tsx scripts/load-marketplace-evidence.ts <evidence> <chain>
//            (3) python build_xxxus30_bundle.py <hdr dump>  (4) npx tsx scripts/create-xxxus30-listing.ts
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile, rm } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";
import { runIngestionPipeline } from "../services/marketplace/factory/ingestion";
import { evaluateEligibility } from "../services/marketplace/factory/eligibility";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const SLUG = "xxx-us30-multi-module-breakout";
const TRADING_SYSTEM_ID = "XXXUS30";
const VERSION_ID = "XXXUS30-v1.01-2025-2026-BASELINE";
const PRICE_USD = 699;
const M15 = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m15-new-products");
const ZIP_PATH = path.join(M15, "source", "XXXUS30_v1.01.zip");  // v1.01 logic; AI model embedded
const ICON_PATH = path.join(M15, "branding", "xxxus30-icon.svg");
const BANNER_PATH = path.join(M15, "branding", "xxxus30-banner.svg");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const description = `XXX US30 is a seller-provided multi-module breakout EA for the Dow Jones index (US30) on the M15 chart. Instead of one entry rule it runs 5 independent breakout modules at once - Nova (prior daily high/low), Apex (12-bar high/low), Zenith (20-bar high/low), Pulse (an ATR-scaled offset from the last close) and Eclipse (fractal high/low) - each placing its own pending stop order when an H1 EMA 50/200 trend filter agrees with the direction. An optional ONNX AI filter (a small neural network trained by the seller, built into the EA, default threshold 0.80) can additionally score every setup - the backtest below was run WITHOUT it (see "Read before buying"). Every position shares one exit framework: a 45-minute time-stop on losers, automatic breakeven, smart trailing, and a "moon-lock" exit that protects a percentage of a position's own running peak profit. Weekend, spread, prop-firm-mode and daily-loss shields are built in, and an on-chart dashboard (timer-driven) shows balance/equity/drawdown, per-module state, AI status and the last 5 trades. The download contains the compiled EA (the AI model is built in - there are no extra model files to copy), the exact input set used in the backtest and an install guide.

AT24-computed evidence (real MT5 Strategy Tester .xlsx export, Exness US30, M15, 2025-07-01 to 2026-08-07, 25,232 trades; net profit, profit factor and trade count reconcile to the report's own stated values with zero delta; drawdown and recovery use a real M15 bar-level equity curve built from real US30 M15 candles):
- Net profit 465,556 (tester units, see below), profit factor 2.51, win rate 84.8%, average trade +18.45, largest loss -926, longest losing streak 10 trades.
- Maximum equity drawdown 10,859 = 2.24% of the equity at its peak, longest drawdown 22 days. The tester's own relative-drawdown figure is higher at 12.69% (1,274): it occurred early in the run, while the balance was still close to the 10,000 starting deposit. A new account starting at 10,000 should expect the larger percentage early on.
- The result is NOT evenly spread over time: 2025 (Jul-Dec) made 378,097 while 2026 (Jan-Aug) made 87,459 - roughly a fifth of the 2025 monthly pace - and July 2026 was a losing month (-3,293). The validation suite passed its time-split, walk-forward and temporal-stability checks, but a clear slowdown is visible in the most recent months.
- Position profile: up to 11 positions open at the same time, 70% long / 30% short.

Read before buying
- Fixed 1.0 lot: the backtest used 1.0 lot on a 10,000 deposit (the EA's own default is 0.01). Profit and drawdown scale with lot size. All figures above are exactly as printed in the seller's Strategy Tester report; that report prints its currency as "profit in pips", so check the money value of a trade on your own broker/account before relying on any figure.
- Broker points: stop loss, take profit and the other distances are in the symbol's POINTS. Exness US30 has 1 decimal (point 0.1), so 120 points = 12 index points; a 0-decimal broker needs inputs 10x larger. Re-scale before trading.
- The backtest report is dated 13 Sep 2026 while the delivered EA files were last compiled on 5 Oct 2026. The seller states that the trading logic is unchanged between the two; this is the seller's statement and cannot be verified from the files.
- The backtest ran WITHOUT the AI filter. The report lists InpUseONNX=true, but the Strategy Tester could not find the model file, so the EA ran in its fail-safe mode (no AI filter) - confirmed on 8 Oct 2026 by re-running the original EA in the tester. The AI filter is therefore an optional extra that is NOT covered by the evidence above; in a 5-day tester check it cut the number of trades sharply, so results with it switched on will differ. The model (trained by the seller on the most recent 30,000 M15 bars at training time, 5 Jun 2025 to 11 Sep 2026) was trained on data that covers the whole backtest period, so a backtest with it on would be in-sample for the model. This build embeds the model, so it loads reliably in live trading and in the tester; load the included tested-settings file (AI off) to reproduce the evidence.
- Live demo tracking: AT24 Live Results for a demo account running this EA is public at https://www.algotraders24.ai/results/xxxus30-30684e (terminal-reported, not broker-verified, settings of that account are not part of this listing). On 8 Oct 2026 it showed 769 closed trades since 14 Sep 2026, win rate 46.3%, profit factor 1.36 and a maximum drawdown of 61.9% - very different from the backtest figures above, so read both together.
- History quality of the run was 54% real ticks; commission, swap and spread model are not disclosed by the report (spread impact on a 12-point stop can be material). Regime coverage and parameter sensitivity are INCONCLUSIVE - only one parameter set and one instrument were tested.
- Pending-order breakout trading is sensitive to broker stop levels, spread and slippage around news. Past backtest performance is not a guarantee of future results; trading leveraged indices is risky. Test on a demo account first.`;

async function main() {
  const seller = await prisma.user.findFirst({ where: { email: SELLER_EMAIL }, select: { id: true } });
  if (!seller) throw new Error(`No User found for ${SELLER_EMAIL}`);

  const bytes = await readFile(ZIP_PATH);
  const artifactHash = createHash("sha256").update(bytes).digest("hex");
  await mkdir(RELEASES_DIR, { recursive: true });
  const release = await prisma.releaseArtifact.upsert({
    where: { tradingSystemId_versionId_platform_artifactHash: { tradingSystemId: TRADING_SYSTEM_ID, versionId: VERSION_ID, platform: "MT5", artifactHash } },
    create: { tradingSystemId: TRADING_SYSTEM_ID, versionId: VERSION_ID, platform: "MT5", artifactVersion: "v1.01", artifactHash, releaseStatus: "PUBLISHED" },
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
  await writeFile(path.join(RELEASES_DIR, `${release.id}.filename.txt`), "XXXUS30_v1.01.zip", "utf-8");

  const listing = await prisma.marketplaceListing.upsert({
    where: { slug: SLUG },
    create: {
      sellerId: seller.id, slug: SLUG, title: "XXX US30 - Multi-Module Breakout", description,
      media: [], pricing: { model: "one_time", amount: PRICE_USD, currency: "USD" },
      category: "Breakout", platformTag: "MT5", assetTag: "US30",
      tags: ["breakout", "us30", "dow-jones", "index", "onnx", "multi-strategy", "dashboard", "mt5"],
      tradingSystemId: TRADING_SYSTEM_ID, versionId: VERSION_ID,
      publicationState: "DRAFT",
    },
    update: { title: "XXX US30 - Multi-Module Breakout", description, pricing: { model: "one_time", amount: PRICE_USD, currency: "USD" }, versionId: VERSION_ID, tradingSystemId: TRADING_SYSTEM_ID },
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

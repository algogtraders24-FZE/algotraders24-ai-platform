// scripts/create-universalea-listing.ts
// AT24 Universal EA v7.03 - seller-provided XAUUSD M5 pending-stop (straddle) breakout EA. Real .mq5 + real MT5 .xlsx Strategy Tester
// report (ICMarketsSC-Demo, real ticks), processed through the real M2-M7 chain (m15-new-products/generate_universalea_chain.py) with a
// bar-level equity curve built from REAL M15 candles of the report's own broker (XAUUSD_ICMARKETS in quant_engine/market.db).
// The Trust State shown is whatever the chain produced.
//
// Run order: (1) python generate_universalea_chain.py  (2) npx tsx scripts/load-marketplace-evidence.ts <evidence_with_curve.json> <universalea_chain_result.json>
//            (3) python build_universalea_v703.py zip ...  (4) npx tsx scripts/create-universalea-listing.ts
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile, rm } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";
import { runIngestionPipeline } from "../services/marketplace/factory/ingestion";
import { evaluateEligibility } from "../services/marketplace/factory/eligibility";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const SLUG = "at24-universal-ea-xauusd-m5";
const TITLE = "AT24 Universal EA - XAUUSD M5 Pending-Stop Breakout";
const TRADING_SYSTEM_ID = "UNIVERSALEA";
const VERSION_ID = "UNIVERSALEA-v7.03-2025-2026-BASELINE";
const PRICE_USD = 999;
const M15 = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m15-new-products");
const ZIP_PATH = path.join(M15, "source", "UniversalEA_v7.03.zip");
const ICON_PATH = path.join(M15, "branding", "universalea", "icon.png");
const BANNER_PATH = path.join(M15, "branding", "universalea", "banner.png");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const description = `AT24 Universal EA is a seller-provided XAUUSD breakout EA for MetaTrader 5 that trades with pending stop orders on the M5 chart. It manages its own stops once a trade is open and has built-in session, spread and daily-loss protection. One position at a time. The download contains the licence-protected compiled EA, the exact input set used in the backtest and an install guide.

AT24-computed evidence (real MT5 Strategy Tester .xlsx export, ICMarketsSC-Demo, XAUUSD, M5, 2025-09-01 to 2026-10-27, real ticks with 100% history quality, 1,000 USD deposit, fixed 0.05 lot, 2,639 trades; net profit, profit factor and trade count reconcile to the report's own values with zero delta; drawdown and recovery use a real bar-level equity curve built from real XAUUSD M15 candles of the SAME broker, with each trade's own recorded profit as its end point):
- Net profit +9,358 on the 1,000 USD deposit (fixed 0.05 lot, no compounding). Profit factor 1.33, win rate 57.2%, average win +25.17 and average loss -25.38 (a win/loss ratio of about 1), largest win +381, largest loss -143, longest losing streak 11 trades (-276).
- Drawdown is large: the tester's own equity drawdown is 54.3% (770.80) and the equity curve rebuilt from real candles gives a deepest drawdown of 1,010 = 71.3% of the equity at its peak. The longest drawdown lasted about 22 days and the equity was below its previous peak for about three quarters of the period. 0.05 lot on a 1,000 USD account is a high-risk setting.
- The result is uneven over time: 2025 (September to December, 731 trades) made only +1,102 while 2026 (to 26 October, 1,908 trades) made +8,256. The best month, March 2026, made +2,525 (27% of the total); the worst, November 2025, lost -359; 13 of 14 months were positive.
- The validation suite passed its sample-size, out-of-sample, walk-forward, temporal-stability and performance-distribution checks. Regime coverage and parameter sensitivity are INCONCLUSIVE (one parameter set, one instrument, 14 months).

Read before buying
- The evidence comes from the seller's own Strategy Tester report, not from an AT24-run backtest of this exact file. AT24 recomputed every figure from the report's own trade list and rebuilt the equity path from real candles, but it did not re-execute the EA.
- The tested settings are NOT the EA's defaults (the lot was 0.05 against a default of 0.01, and several other inputs differ). Load the included tested-settings file to reproduce the evidence; other settings have NOT been backtested.
- The report shows ZERO commission and a total swap of only -4. An account that charges commission will pay more than the test did, and spread and slippage depend on your broker; the test used the real ticks of one demo account.
- Point-based inputs depend on your broker's digits: the test used a 2-digit gold quote (1 point = 0.01 USD). Session hours are BROKER SERVER time. Check your broker's offset, digits and symbol name first.
- No live or demo results are claimed for this EA. Past backtest performance is not a guarantee of future results; trading leveraged products is risky. Test on a demo account first with a lot that fits your account; this is not financial advice.`;

async function main() {
  const seller = await prisma.user.findFirst({ where: { email: SELLER_EMAIL }, select: { id: true } });
  if (!seller) throw new Error(`No User found for ${SELLER_EMAIL}`);

  const bytes = await readFile(ZIP_PATH);
  const artifactHash = createHash("sha256").update(bytes).digest("hex");
  await mkdir(RELEASES_DIR, { recursive: true });
  const release = await prisma.releaseArtifact.upsert({
    where: { tradingSystemId_versionId_platform_artifactHash: { tradingSystemId: TRADING_SYSTEM_ID, versionId: VERSION_ID, platform: "MT5", artifactHash } },
    create: { tradingSystemId: TRADING_SYSTEM_ID, versionId: VERSION_ID, platform: "MT5", artifactVersion: "v7.03", artifactHash, releaseStatus: "PUBLISHED" },
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
  await writeFile(path.join(RELEASES_DIR, `${release.id}.filename.txt`), "UniversalEA_v7.03.zip", "utf-8");

  const listing = await prisma.marketplaceListing.upsert({
    where: { slug: SLUG },
    create: {
      sellerId: seller.id, slug: SLUG, title: TITLE, description,
      media: [], pricing: { model: "one_time", amount: PRICE_USD, currency: "USD" },
      category: "Breakout", platformTag: "MT5", assetTag: "Gold",
      tags: ["gold", "xauusd", "breakout", "pending-orders", "atr", "trailing-stop", "m5", "mt5"],
      tradingSystemId: TRADING_SYSTEM_ID, versionId: VERSION_ID,
      publicationState: "DRAFT",
    },
    update: { title: TITLE, description, pricing: { model: "one_time", amount: PRICE_USD, currency: "USD" }, versionId: VERSION_ID, tradingSystemId: TRADING_SYSTEM_ID },
  });

  const mediaDir = path.join(__dirname, "..", "public", "marketplace", listing.id);
  await mkdir(mediaDir, { recursive: true });
  await copyFile(ICON_PATH, path.join(mediaDir, "icon.png"));
  await copyFile(BANNER_PATH, path.join(mediaDir, "banner.png"));
  const media = [`/marketplace/${listing.id}/icon.png`, `/marketplace/${listing.id}/banner.png`];
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

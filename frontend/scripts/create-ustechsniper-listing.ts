// scripts/create-ustechsniper-listing.ts
// USTECH Index Sniper - seller-provided US Tech index M1 pending-stop trend-continuation EA. Real .mq5 + real MT5 .html Strategy
// Tester report, processed through the real M2-M7 chain (ea-research/marketplace-research/m15-new-products/
// generate_ustechsniper_chain.py, trade-by-trade evidence - no bar-level curve: custom symbol). Same ingestion +
// eligibility pipeline as every other listing; the Trust State shown is whatever the chain produced.
//
// Run order: (1) python generate_ustechsniper_chain.py  (2) npx tsx scripts/load-marketplace-evidence.ts <evidence> <chain>
//            (3) python build_ustechsniper_bundle.py <licensed ex5> <report>  (4) npx tsx scripts/create-ustechsniper-listing.ts
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile, rm } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";
import { runIngestionPipeline } from "../services/marketplace/factory/ingestion";
import { evaluateEligibility } from "../services/marketplace/factory/eligibility";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const SLUG = "ustech-index-sniper-m1-pending-scalper";
const TITLE = "USTECH Index Sniper - US Tech M1 Pending-Stop Scalper";
const TRADING_SYSTEM_ID = "USTECHSNIPER";
const VERSION_ID = "USTECHSNIPER-v1.00-2025-2026-BASELINE";
const PRICE_USD = 2999;
const M15 = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m15-new-products");
const ZIP_PATH = path.join(M15, "source", "USTECHIndexSniper_v1.00.zip");
const ICON_PATH = path.join(M15, "branding", "ustech-final", "icon.png");
const BANNER_PATH = path.join(M15, "branding", "ustech-final", "banner.png");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const description = `USTECH Index Sniper is a seller-provided scalper for the US Tech (Nasdaq 100) index on MetaTrader 5 that trades trend continuation with ONE precise pending order at a time. After every closed M1 bar it looks for two things at once: an M5 EMA(50) trend (price on the right side of a rising or falling EMA) and a fresh 3-candle fair value gap of at least 8 pips in the same direction. When both agree it places a single buy-stop or sell-stop just beyond the high/low of the last 5 M1 bars (30 points of buffer), with a fixed stop loss and take profit, and cancels the order if it is not triggered within 3 minutes. There is never more than one position or pending order, with a 30-second cooldown between orders. Open trades are managed on every tick by break-even and trailing rules. It only trades inside the London and New York sessions and only when the spread is acceptable. Optional filters in the code (CVD pressure proxy, entropy/volatility regime, tick order-flow) were switched OFF in the tested run. The download contains the licence-protected compiled EA, the exact input set used in the backtest and an install guide.

AT24-computed evidence (real MT5 Strategy Tester .html export, Exness demo server, M1, first trade 2025-06-16, last trade 2026-09-10, 14,893 trades; AT24 recomputed the net profit and trade count from the report's own deals list and both match the report exactly; drawdown figures below are computed on CLOSED trades (balance), not intraday equity):
- Tester result: net profit 36,680,484 on a 100,000 USD deposit with RISK-BASED lot sizing (2% of equity per trade, so the lot grew from 0.4 to 20.0 lots during the run), profit factor 1.76 as printed by the report (AT24's trade-level recomputation gives 2.10 because the two count commission differently). This headline is the result of compounding on a custom symbol - it is NOT a realistic expectation for a live account.
- 94.6% of trades were net winners (the report prints 97.4% before commission), but the average losing trade was about 8 times the average winner (about -41,275 vs +4,969 per trade); the largest single loss was about 731,000, the longest winning streak 200 trades and the longest losing streak 3.
- Maximum drawdown on closed trades (balance) 11.28%, matching the tester's own balance drawdown. The tester report also prints a 100% EQUITY drawdown. AT24 could not rebuild an intraday equity curve (no candle data exists for the custom symbol), so intraday drawdown is NOT independently verified - treat the 100% figure as unexplained.
- Very uneven in time: June-December 2025 made +40.8 million (the best month, November 2025, was 38.1% of the total); January-September 2026 was net NEGATIVE (-4.1 million) with 6 losing months out of 9. Recent behaviour of the tested settings is weaker than the headline suggests.
- Position profile: 8,312 long / 6,581 short trades. The automated validation suite passed its sample-size, out-of-sample, walk-forward, temporal-stability and performance-distribution checks; regime coverage and parameter sensitivity are INCONCLUSIVE (one parameter set, one instrument). Risk analysis is PARTIAL (drawdown, recovery and regime dimensions incomplete), so the Trust State is LIMITED.

Read before buying
- The evidence comes from the seller's own Strategy Tester report, not from an AT24-run backtest of this exact file. AT24 recomputed every figure from the report's own trade list, but it did not re-execute the EA and could not verify the intraday equity path.
- The test ran on a CUSTOM symbol named USTEC_x100 on an Exness demo server, not on a standard broker index symbol. On that symbol one lot earned or lost 100 USD per index point (checked on the first trade), far more than a normal index CFD, so the lot sizes, profits and drawdowns in the report cannot be copied to a real symbol. Only the percentage-risk sizing carries over; spread, slippage, commission and lot limits on your broker's symbol will differ.
- Name: the Strategy Tester report carries the EA's earlier working name. The seller states that the file was only renamed to "USTECH Index Sniper" for this listing (order comments and texts renamed) with the trading logic unchanged; AT24 compared the renamed source with the seller's file and the trading code is identical, but the link to the earlier test run is the seller's statement and cannot be verified from the files.
- The tested settings are NOT the EA's defaults: the run used a 2% risk per trade, StopLossPips=5000 and TakeProfitPips=11000 (with PipSize=0.01 that is a 50 and 110 price-unit move), point-based break-even and trailing, and the CVD / regime / order-flow filters OFF. The built-in defaults are different (for example 0.5% risk, StopLossPips=50, TakeProfitPips=100, all filters ON). Load the included tested-settings file to reproduce the evidence - but lower the risk for live use; other settings have NOT been backtested.
- History quality of the run was 43% real ticks; spread and swap models are not disclosed by the report (a commission of 25 USD per 0.4 lot is visible in the deals).
- Session hours are BROKER SERVER time and index symbol names differ by broker (USTEC / NAS100 / US100 ...); check your broker's offset, digits and PipSize first.
- No live or demo results are claimed for this EA. Past backtest performance is not a guarantee of future results; trading leveraged products is risky. Test on a demo account with a small risk setting first; this is not financial advice.`;

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
  await writeFile(path.join(RELEASES_DIR, `${release.id}.filename.txt`), "USTECHIndexSniper_v1.00.zip", "utf-8");

  const listing = await prisma.marketplaceListing.upsert({
    where: { slug: SLUG },
    create: {
      sellerId: seller.id, slug: SLUG, title: TITLE, description,
      media: [], pricing: { model: "one_time", amount: PRICE_USD, currency: "USD" },
      category: "Scalping", platformTag: "MT5", assetTag: "Indices",
      tags: ["nasdaq", "us-tech", "ustec", "nas100", "index", "scalping", "pending-orders", "fair-value-gap", "trend", "m1", "mt5"],
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

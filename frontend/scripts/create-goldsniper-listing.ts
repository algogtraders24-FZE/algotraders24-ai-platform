// scripts/create-goldsniper-listing.ts
// Gold Sniper - seller-provided XAUUSD M1 pending-stop trend-continuation EA. Real .mq5 + real MT5 .xlsx Strategy
// Tester report, processed through the real M2-M7 chain (ea-research/marketplace-research/m15-new-products/
// generate_goldsniper_chain.py, trade-by-trade evidence - no bar-level curve because candle data had gaps). Same ingestion +
// eligibility pipeline as every other listing; the Trust State shown is whatever the chain produced.
//
// Run order: (1) python generate_goldsniper_chain.py  (2) npx tsx scripts/load-marketplace-evidence.ts <evidence> <chain>
//            (3) python build_goldsniper_bundle.py <licensed ex5> <report>  (4) npx tsx scripts/create-goldsniper-listing.ts
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile, rm } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";
import { runIngestionPipeline } from "../services/marketplace/factory/ingestion";
import { evaluateEligibility } from "../services/marketplace/factory/eligibility";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const SLUG = "gold-sniper-xauusd-m1-pending-scalper";
const TITLE = "Gold Sniper - XAUUSD M1 Pending-Stop Scalper";
const TRADING_SYSTEM_ID = "GOLDSNIPER";
const VERSION_ID = "GOLDSNIPER-v1.00-2025-2026-BASELINE";
const PRICE_USD = 999;
const M15 = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m15-new-products");
const ZIP_PATH = path.join(M15, "source", "GoldSniper_v1.00.zip");
const ICON_PATH = path.join(M15, "branding", "final", "icon.png");
const BANNER_PATH = path.join(M15, "branding", "final", "banner.png");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const description = `Gold Sniper is a seller-provided XAUUSD scalper for MetaTrader 5 that trades trend continuation with ONE precise pending order at a time. After every closed M1 bar it looks for two things at once: an M5 EMA(50) trend (price on the right side of a rising or falling EMA) and a fresh 3-candle fair value gap of at least 8 pips in the same direction. When both agree it places a single buy-stop or sell-stop just beyond the high/low of the last 5 M1 bars (30 points of buffer), with a fixed stop loss and take profit, and cancels the order if it is not triggered within 3 minutes. There is never more than one position or pending order, with a 30-second cooldown between orders. Open trades are managed on every tick by a break-even rule and a fixed-distance trailing stop. It only trades inside the London and New York sessions and only when the spread is acceptable. Optional filters in the code (CVD pressure proxy, entropy/volatility regime, tick order-flow) were switched OFF in the tested run. The download contains the licence-protected compiled EA, the exact input set used in the backtest and an install guide.

AT24-computed evidence (real MT5 Strategy Tester .xlsx export, Exness XAUUSD, M1, 2025-01-06 to 2026-10-08, 539 trades; net profit, profit factor and trade count reconcile to the report's own values with zero delta or within rounding; drawdown figures below are computed on CLOSED trades (balance), not intraday equity):
- Net profit 264,229.78 on a 100,000 USD deposit with a fixed 1.0 lot, profit factor 1.28, win rate 52.5%, average trade +490, largest win +19,997, largest loss -11,056, longest losing streak 9 trades.
- Maximum drawdown on closed trades (balance) 66,245 = 25.84% of the balance at its peak, longest drawdown about 91 days; the tester's own balance drawdown is 25.84% as well. The tester report also prints a 100% EQUITY drawdown. AT24 could not rebuild an intraday equity curve for the whole period (real candle data was missing for roughly 7 of the 21 months), so intraday drawdown is NOT independently verified - treat the 100% figure as unexplained and expect intraday drawdowns of at least the closed-trade level.
- Not evenly spread: 2025 made +124,780 (166 trades) and 2026 so far +139,450 (373 trades). The best month, October 2025, made +93,867 = 35.5% of the total profit, and 9 of the 22 months were losing months (worst: December 2025, -17,739). Without that one month the result would look very different.
- Position profile: 248 long / 291 short trades. The validation suite passed its sample-size, out-of-sample, walk-forward, temporal-stability and performance-distribution checks; regime coverage and parameter sensitivity are INCONCLUSIVE (one parameter set, one instrument).

Read before buying
- The evidence comes from the seller's own Strategy Tester report, not from an AT24-run backtest of this exact file. AT24 recomputed every figure from the report's own trade list, but it did not re-execute the EA and could not verify the intraday equity path.
- Name: the Strategy Tester report carries the EA's earlier working name. The seller states that the file was only renamed to "Gold Sniper" for this listing (and the order comments renamed) with the trading logic unchanged; this is the seller's statement and cannot be verified from the files.
- The tested settings are NOT the EA's defaults: the run used StopLossPips=5000, TakeProfitPips=20000, break-even trigger 10000, trailing 3000/1000, a fixed 1.0 lot and the CVD / regime / order-flow filters OFF. The built-in defaults are very different (for example StopLossPips=50, TakeProfitPips=100, risk-based lot, filters ON). Load the included tested-settings file to reproduce the evidence; other settings have NOT been backtested.
- "Pips" in this EA are 0.01 price units: a stop of 5000 is a 50.00 USD move and the take profit of 20000 a 200.00 USD move. At 1.0 lot (100 oz) a 50 USD stop is roughly 5,000 USD of risk, about 5% of the tested deposit - and the largest single loss (11,056) was more than twice that, which the report does not explain (slippage or a gap is the usual cause).
- Lot size: all results scale with lot size. The same risk on a 10,000 USD account is about 0.1 lot, on 1,000 USD about 0.01 lot. Choose your own size.
- History quality of the run was 43% real ticks; spread, commission and swap models are not disclosed by the report. Pending-order EAs on gold are sensitive to spread, slippage and stop levels around news.
- Session hours are BROKER SERVER time (tested on Exness) and symbol naming differs by broker (XAUUSD / XAUUSDm / GOLD ...) - check your broker's offset, digits and PipSize first.
- No live or demo results are claimed for this EA. Past backtest performance is not a guarantee of future results; trading leveraged products is risky. Test on a demo account first; this is not financial advice.`;

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
  await writeFile(path.join(RELEASES_DIR, `${release.id}.filename.txt`), "GoldSniper_v1.00.zip", "utf-8");

  const listing = await prisma.marketplaceListing.upsert({
    where: { slug: SLUG },
    create: {
      sellerId: seller.id, slug: SLUG, title: TITLE, description,
      media: [], pricing: { model: "one_time", amount: PRICE_USD, currency: "USD" },
      category: "Scalping", platformTag: "MT5", assetTag: "Gold",
      tags: ["gold", "xauusd", "scalping", "pending-orders", "fair-value-gap", "trend", "m1", "mt5"],
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

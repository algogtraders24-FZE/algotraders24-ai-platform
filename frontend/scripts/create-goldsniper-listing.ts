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
const VERSION_ID = "GOLDSNIPER-v1.00-2025-2026-RISK2-BASELINE";
const PRICE_USD = 999;
const M15 = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m15-new-products");
const ZIP_PATH = path.join(M15, "source", "GoldSniper_v1.00.zip");
const ICON_PATH = path.join(M15, "branding", "final", "icon.png");
const BANNER_PATH = path.join(M15, "branding", "final", "banner.png");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const description = `Gold Sniper is a seller-provided XAUUSD scalper for MetaTrader 5 that trades trend continuation with ONE precise pending order at a time. After every closed M1 bar it looks for two things at once: an M5 EMA(50) trend (price on the right side of a rising or falling EMA) and a fresh 3-candle fair value gap of at least 8 pips in the same direction. When both agree it places a single buy-stop or sell-stop just beyond the high/low of the last 5 M1 bars (30 points of buffer), with a fixed stop loss and take profit, and cancels the order if it is not triggered within 3 minutes. There is never more than one position or pending order, with a 30-second cooldown between orders. Open trades are managed on every tick: in the tested configuration the stop moves to break-even + 20 points once a trade is 100 points (1.00 USD) in profit and a fixed trailing stop 10 pips (0.10 USD) behind the price follows it, so many trades close within seconds. It only trades inside the London and New York sessions and only when the spread is acceptable. Optional filters in the code (CVD pressure proxy, entropy/volatility regime, tick order-flow) were switched OFF in the tested run. The download contains the licence-protected compiled EA, the exact input set used in the backtest and an install guide.

AT24-computed evidence (real MT5 Strategy Tester .xlsx export, Exness XAUUSD, M1, 2025-01-02 to 2026-10-08, 16,522 trades, 100,000 USD deposit; net profit and trade count reconcile to the report's own values with zero delta; drawdown and recovery use a real bar-level equity curve built from real XAUUSD M15 candles of the same broker, with each trade's own recorded profit as its end point):
- Net profit 678,176.55 with a risk-based lot of 2% per trade (lot grows with the balance, 0.39 to 4.16 lots, so profit compounds). Profit factor 1.55 as printed in the report (AT24's own recomputation gives 1.63 - the two differ and the report's figure is the more conservative one), win rate 74.6%, average trade +41, largest win +10,628, largest loss -25,753, longest losing streak 11 trades.
- Maximum equity drawdown on that curve 263,906 = 25.33% of the equity at its peak, longest drawdown about 189 days; the tester's own balance drawdown is 25.26% (263,031). The tester report also prints a 100% EQUITY drawdown that the real-candle curve does NOT reproduce - treat that figure as unexplained. The curve is a reconstruction from candles between each trade's real entry and exit, not the tester's own tick path, so a tick-level equity low can still differ.
- The result FADED: 2025 made +769,619 (8,995 trades) while 2026 up to 9 October LOST -91,442 (7,527 trades). The best month, October 2025, made +235,535 = 34.7% of the total profit; 8 of 22 months were losing months, the worst was April 2026 (-57,445). The validation suite passed its sample-size, out-of-sample, walk-forward, temporal-stability and performance-distribution checks, but a clear deterioration is visible in 2026.
- Regime coverage and parameter sensitivity are INCONCLUSIVE (one parameter set, one instrument).

Read before buying
- The evidence comes from the seller's own Strategy Tester report, not from an AT24-run backtest of this exact file. AT24 recomputed every figure from the report's own trade list and rebuilt the equity path from real candles, but it did not re-execute the EA.
- Name and inputs: the report carries the EA's earlier working name (XAU_M1_Pips_Dollar_SLTP_Trailing_Final). The seller states that the file was only renamed to "Gold Sniper" (order comments renamed too) with the trading logic unchanged; this is the seller's statement and cannot be verified from the files.
- The tested settings are NOT the EA's defaults: StopLossPips=5000, TakeProfitPips=11000, RiskPercent=2, UsePipsForTrailing=false (break-even and trailing then use the POINT inputs: 100 / 20 points and a 10-pip fixed trail) and the CVD / regime / order-flow filters OFF. The built-in defaults are very different (for example StopLossPips=50, TakeProfitPips=100, RiskPercent=0.5, filters ON). Load the included tested-settings file to reproduce the evidence; other settings have NOT been backtested.
- Break-even is NOT switched off in the tested configuration: the pip-based break-even inputs are bypassed, but the points-based break-even and trailing are active. The points inputs depend on your broker's digits (tested on a 2-digit gold quote, 1 point = 0.01 USD); on a 3-digit quote the same inputs are ten times smaller and behaviour will differ.
- "Pips" in this EA are 0.01 price units: a stop of 5000 is a 50.00 USD move and the take profit of 11000 a 110.00 USD move. 2% risk per trade is a high-risk setting; the largest single loss in the test (-25,753) was more than 25% of the starting deposit. Choose a risk that is right for you (for example 0.5% or lower) - all results and drawdown scale with it.
- Very short trades: the median trade lasted about 13 seconds. A scalper like this depends heavily on spread, slippage, execution speed and the broker's stop level; the tested run used 43% real ticks and the spread, commission and swap models are not disclosed by the report. Live results can be very different from the backtest.
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

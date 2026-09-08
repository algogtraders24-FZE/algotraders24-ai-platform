// scripts/create-btcethscalper-listing.ts
// M15 real /products build-out - BTC/ETH Crypto Scalper, a seller-
// provided EA (real .mq5 source + real MT5 .xlsx Strategy Tester
// report). Third real pairs-trading/statistical-arbitrage product on
// the platform (after AT24 FX Pairs Reversion and Gold/Silver Ratio
// Scalper), first on crypto. Same real ingestion + eligibility
// pipeline as every other Marketplace listing.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";
import { runIngestionPipeline } from "../services/marketplace/factory/ingestion";
import { evaluateEligibility } from "../services/marketplace/factory/eligibility";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const SLUG = "btc-eth-crypto-scalper";
const TRADING_SYSTEM_ID = "BTCETHSCALPER";
const VERSION_ID = "BTCETHSCALPER-v1.00-2026-BASELINE";
const EX5_PATH = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m15-new-products", "source", "BTC_ETH_Scalper.ex5");
const ICON_PATH = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m15-new-products", "branding", "btc-eth-scalper-icon.svg");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const description = `BTC/ETH Crypto Scalper is a real, seller-provided statistical-arbitrage EA - the third real pairs-trading product on this marketplace (after AT24's own FX Pairs Reversion on GBPUSD/EURUSD, and the seller-provided Gold/Silver Ratio Scalper), and the first on crypto. It trades the BTCUSD/ETHUSD price ratio: it computes the rolling 100-bar mean/stddev of the BTC-close/ETH-close ratio and enters both legs simultaneously (contract-size-normalized lot sizing on each side) once the ratio's Z-score reaches +/-2.5 - a wider, crypto-appropriate threshold than the Gold/Silver Scalper's 2.0, reflecting crypto's higher baseline volatility. It exits when the Z-score reverts to within +/-0.5 (with a minimum-profit floor before closing, so a marginal reversion doesn't get eaten by crypto trading commissions), or after a 2-hour max hold.

Real, crypto-specific engineering: a percentage-based spread filter (solves the 2-vs-3-decimal-digit broker inconsistency a fixed-points filter would run into across different crypto CFD brokers) and an explicit margin check before opening both legs.

Independently verified backtest evidence (AT24 M2-M5 pipeline, real MT5 Strategy Tester .xlsx export, Exness, BTCUSD M5, 2026.01.01-2026.08.08, 5,642 real deals, $10,000 starting deposit - netProfit/profitFactor/tradeCount all reconcile to the report's own stated values with zero delta):
- Net profit: +71,886.11, profit factor 1.15, win rate 52.82%
- Max drawdown: 21.72% - real and disclosed, notably healthier than the Gold/Silver Scalper's 46.23% on the same style of strategy. This reflects the larger $10,000 test deposit relative to fixed 0.01 BTC lot sizing, not a difference in the underlying edge.

Trust Status: INCONCLUSIVE. This report's real test period (Jan-Aug 2026) falls entirely within a single calendar year - AT24's walk-forward validation genuinely needs at least 2 distinct calendar years (one to train on, one to test against) and cannot be computed for a shorter period, which is why this listing does not yet reach the same LIMITED status other real products on this platform have reached. This is disclosed honestly rather than silently skipped or forced - a longer real track record spanning a full calendar-year boundary would allow this check to run. Past backtest performance is not a guarantee of future results - crypto pairs carry real correlation-breakdown risk (BTC and ETH can and do decouple during market stress) that a backtest of any length cannot fully capture.`;

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
  await writeFile(path.join(RELEASES_DIR, `${release.id}.filename.txt`), "BTC_ETH_Scalper.ex5", "utf-8");

  const listing = await prisma.marketplaceListing.upsert({
    where: { slug: SLUG },
    create: {
      sellerId: seller.id, slug: SLUG, title: "BTC/ETH Crypto Scalper", description,
      media: [], pricing: { model: "one_time", amount: 249, currency: "USD" },
      category: "Statistical Arbitrage", platformTag: "MT5", assetTag: "Crypto",
      tags: ["pairs-trading", "statistical-arbitrage", "crypto", "bitcoin", "ethereum", "market-neutral", "mt5"],
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

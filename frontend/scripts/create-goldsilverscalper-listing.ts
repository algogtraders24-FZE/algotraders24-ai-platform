// scripts/create-goldsilverscalper-listing.ts
// M15 real /products build-out - Gold/Silver Ratio Scalper, a seller-
// provided EA (real .mq5 source + real MT5 .xlsx Strategy Tester
// report). Genuine statistical arbitrage: Z-score mean reversion on
// the XAUUSD/XAGUSD price ratio, market-neutral (dual-leg pair trade,
// not a single-instrument directional bet) - the second real pairs-
// trading product on the platform after AT24 FX Pairs Reversion, this
// time seller-provided rather than AT24-built. Same real ingestion +
// eligibility pipeline as every other Marketplace listing.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";
import { runIngestionPipeline } from "../services/marketplace/factory/ingestion";
import { evaluateEligibility } from "../services/marketplace/factory/eligibility";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const SLUG = "gold-silver-ratio-scalper";
const TRADING_SYSTEM_ID = "GOLDSILVERSCALPER";
const VERSION_ID = "GOLDSILVERSCALPER-v1.01-2026-BASELINE";
const EX5_PATH = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m15-new-products", "source", "Gold_Silver_Ratio_Scalper.ex5");
const ICON_PATH = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m15-new-products", "branding", "gold-silver-ratio-scalper-icon.svg");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const description = `Gold/Silver Ratio Scalper is a real, seller-provided statistical-arbitrage EA - the second real pairs-trading product on this marketplace, alongside AT24's own FX Pairs Reversion (GBPUSD/EURUSD). This one trades the XAUUSD/XAGUSD price ratio: it computes the Gold-close/Silver-close ratio over a rolling 100-bar window, tracks its mean and standard deviation, and enters BOTH legs simultaneously (contract-size-normalized lot sizing on each side) once the ratio's Z-score reaches +/-2.0 - betting on reversion back toward the ratio's own recent average, not on either metal's own direction. It exits when the Z-score reverts to within +/-0.5, or after a 1-hour max hold, whichever comes first.

Independently verified backtest evidence (AT24 M2-M5 pipeline, real MT5 Strategy Tester .xlsx export, Exness, XAUUSD/XAGUSD M1, 2025.01.01-2026.08.07, 22,484 real deals - netProfit/profitFactor/tradeCount all reconcile to the report's own stated values with zero delta):
- Net profit: +20,702.75 (1,000 starting deposit) - profit factor 1.15, win rate 50.5%
- Max drawdown: 46.23% - real and significant, but NOT a compounding-lot-size story like some other listings here: this EA's Gold-leg lot size is fixed (0.01), not balance-based. The drawdown instead reflects a genuinely undercapitalized $1,000 test deposit relative to the strategy's own real equity swings - a real 14-trade losing streak appears in the actual data. A larger starting deposit would show a materially smaller percentage drawdown on these same real trades.
- 22,484 trades over ~19 months (M1 timeframe) is aggressive scalping - real broker execution latency and slippage on two simultaneous legs are not modeled in any backtest; live results on a dual-symbol pair trade depend heavily on your broker's fill quality on both XAUUSD and XAGUSD at once.

Trust Status: INCONCLUSIVE. Evidence integrity is verified and validation has passed everywhere it can currently be computed, but market-regime coverage and parameter-sensitivity are not yet computable (same open, program-wide gap as every other AT24 product). Requires both XAUUSD and XAGUSD in Market Watch. Past backtest performance is not a guarantee of future results.`;

async function main() {
  const seller = await prisma.user.findFirst({ where: { email: SELLER_EMAIL }, select: { id: true } });
  if (!seller) throw new Error(`No User found for ${SELLER_EMAIL}`);

  const bytes = await readFile(EX5_PATH);
  const artifactHash = createHash("sha256").update(bytes).digest("hex");
  await mkdir(RELEASES_DIR, { recursive: true });
  const release = await prisma.releaseArtifact.upsert({
    where: { tradingSystemId_versionId_platform_artifactHash: { tradingSystemId: TRADING_SYSTEM_ID, versionId: VERSION_ID, platform: "MT5", artifactHash } },
    create: { tradingSystemId: TRADING_SYSTEM_ID, versionId: VERSION_ID, platform: "MT5", artifactVersion: "v1.01", artifactHash, releaseStatus: "PUBLISHED" },
    update: { releaseStatus: "PUBLISHED" },
  });
  await writeFile(path.join(RELEASES_DIR, `${release.id}.ex5`), bytes);
  await writeFile(path.join(RELEASES_DIR, `${release.id}.filename.txt`), "Gold_Silver_Ratio_Scalper.ex5", "utf-8");

  const listing = await prisma.marketplaceListing.upsert({
    where: { slug: SLUG },
    create: {
      sellerId: seller.id, slug: SLUG, title: "Gold/Silver Ratio Scalper", description,
      media: [], pricing: { model: "one_time", amount: 219, currency: "USD" },
      category: "Statistical Arbitrage", platformTag: "MT5", assetTag: "Gold/Silver",
      tags: ["pairs-trading", "statistical-arbitrage", "gold", "silver", "market-neutral", "mt5"],
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

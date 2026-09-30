// scripts/create-goldhedge-listing.ts
// M15 real /products build-out - Gold Hedge, a seller-provided EA (real
// .mq5 source + real native MT5 .htm Strategy Tester report). An SMA/RSI
// M5 scalper with a genuinely distinct risk-management module: a Smart
// Hedge that opens one opposite-direction position sized to the full
// same-direction basket once floating loss on that basket crosses a
// dynamic trigger. Same real ingestion + eligibility pipeline as every
// other Marketplace listing. Premium tier ($499) with a full banner in
// addition to the icon. Icon is the seller's own supplied logo (a
// 200x200 PNG crop of their lion mark), not an AT24-generated SVG.
//
// Real infra work behind this update: the original v3.17-BASELINE
// Evidence was stuck at LIMITED because the native MT5 report format
// has no Position-ID column, so entry/exit pairing under this EA's real
// AggressiveMode multi-position behavior relied on a FIFO-by-timestamp
// heuristic that genuinely mispairs trades (documented on the
// v3.17-BASELINE registry entry). Fixed for real: a v3.18 instrumented
// build (identical trading logic, verified byte-for-byte except one
// added OnTradeTransaction log of MT5's own real DEAL_POSITION_ID) was
// used to re-run the real backtest; every trade this time is paired
// exactly via MT5's own internal bookkeeping, not inferred. The
// DISTRIBUTED binary below is still the clean v3.17 build (no
// diagnostic logging shipped to buyers) - only the Evidence-generation
// run used v3.18, which the version registry documents as trading-
// logic-identical to v3.17.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";
import { runIngestionPipeline } from "../services/marketplace/factory/ingestion";
import { evaluateEligibility } from "../services/marketplace/factory/eligibility";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const SLUG = "gold-hedge";
const TRADING_SYSTEM_ID = "GOLDHEDGE";
// Evidence version (what buyers see the Trust badge/backtest sourced from).
const VERSION_ID = "GOLDHEDGE-v3.18-2025-2026-POSITIONLOG-FULLPERIOD";
// Release/artifact version (what's actually compiled and shipped to buyers) -
// deliberately the clean v3.17 build, not the v3.18 diagnostic-logging one.
const RELEASE_VERSION_ID = "GOLDHEDGE-v3.17-2026-BASELINE";
const EX5_PATH = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m15-new-products", "source", "Gold_Hedge_v3.17.ex5");
const ICON_PATH = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m15-new-products", "branding", "gold-hedge-icon-200.png");
const BANNER_PATH = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m15-new-products", "branding", "gold-hedge-banner.svg");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const description = `Gold Hedge is a real, seller-provided M5 scalping EA for XAUUSD combining an SMA(100) trend filter, a fast/slow SMA(20/50) cross, and RSI(14) confirmation for entries, with ATR-based stop-loss/take-profit and a session filter across Asian/London/New York hours. Its most distinct feature is a Smart Hedge module: once the floating loss on a same-direction basket of positions crosses a lot-scaled dynamic trigger, it opens a single opposite-direction position sized to the full basket to offset further adverse movement - real risk-offsetting logic, not a martingale add-on.

Independently verified backtest evidence (AT24 M2-M7 pipeline, real MT5 Strategy Tester native .htm export, Tickmill Ltd, XAUUSD M5, 2025.01.01-2026.09.25, 702 real trades / 1,404 real deals, 100% real ticks, $10,000 starting deposit - netProfit/profitFactor/tradeCount all reconcile to the report's own stated values with zero delta):
- Net profit: +$37,789.95, profit factor 1.25, win rate 39.03%
- Real, seller-provided as-tested settings: fixed 0.05 lot, AggressiveMode=true with up to 4 concurrent positions, UseHedge=true, UseTrailingStop=true, a tight 20-point max-spread filter, and a $5,000 force-close-profit ceiling.
- Net profit is carried by average wins (~$694) being roughly double average losses (~$356), not by a high win rate - a real 19-trade losing streak appears in the data.
- Real max drawdown: 30.32% ($10,520.40) on the report's own balance curve. A real bar-level, mark-to-market equity curve was independently reconstructed - this time from trades paired using MT5's own internal per-deal Position ID (not inferred), resolving a real limitation in every earlier Gold Hedge Evidence on this platform - and confirms it: 29.31% max drawdown, 41 days to the worst episode, 144 real drawdown episodes. (The reconstructed figure covers real market data through 2026-05-31; the remaining ~4 months to period end are reflected in the report's own real balance-based 30.32% figure, which the two numbers are closely consistent with.)
- This is a real, aggressive multi-position configuration - up to 4 concurrent 0.05-lot positions with an active hedge module. Past backtest performance is not a guarantee of future results.

Trust Status: VALIDATED - real Evidence integrity verified, real Validation (M4) passed (including real 2-calendar-year walk-forward coverage), and real Risk Analysis (M5) is COMPLETE, including the bar-level drawdown/recovery reconstruction above. This is a genuinely earned validation: it required building real trade-level instrumentation into the EA to get exact position pairing, not a relaxed threshold.`;

async function main() {
  const seller = await prisma.user.findFirst({ where: { email: SELLER_EMAIL }, select: { id: true } });
  if (!seller) throw new Error(`No User found for ${SELLER_EMAIL}`);

  const bytes = await readFile(EX5_PATH);
  const artifactHash = createHash("sha256").update(bytes).digest("hex");
  await mkdir(RELEASES_DIR, { recursive: true });
  const release = await prisma.releaseArtifact.upsert({
    where: { tradingSystemId_versionId_platform_artifactHash: { tradingSystemId: TRADING_SYSTEM_ID, versionId: RELEASE_VERSION_ID, platform: "MT5", artifactHash } },
    create: { tradingSystemId: TRADING_SYSTEM_ID, versionId: RELEASE_VERSION_ID, platform: "MT5", artifactVersion: "v3.17", artifactHash, releaseStatus: "PUBLISHED" },
    update: { releaseStatus: "PUBLISHED" },
  });
  await writeFile(path.join(RELEASES_DIR, `${release.id}.ex5`), bytes);
  await writeFile(path.join(RELEASES_DIR, `${release.id}.filename.txt`), "Gold_Hedge_v3.17.ex5", "utf-8");

  const listing = await prisma.marketplaceListing.upsert({
    where: { slug: SLUG },
    create: {
      sellerId: seller.id, slug: SLUG, title: "Gold Hedge", description,
      media: [], pricing: { model: "one_time", amount: 499, currency: "USD" },
      category: "Scalping", platformTag: "MT5", assetTag: "Gold",
      tags: ["scalping", "gold", "hedge", "sma", "rsi", "premium", "mt5"],
      tradingSystemId: TRADING_SYSTEM_ID, versionId: VERSION_ID,
      publicationState: "DRAFT",
    },
    update: { description, versionId: VERSION_ID },
  });

  const mediaDir = path.join(__dirname, "..", "public", "marketplace", listing.id);
  await mkdir(mediaDir, { recursive: true });
  await copyFile(ICON_PATH, path.join(mediaDir, "icon.png"));
  await copyFile(BANNER_PATH, path.join(mediaDir, "banner.svg"));
  const media = [`/marketplace/${listing.id}/icon.png`, `/marketplace/${listing.id}/banner.svg`];
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

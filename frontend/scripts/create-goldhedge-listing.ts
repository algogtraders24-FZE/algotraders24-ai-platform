// scripts/create-goldhedge-listing.ts
// M15 real /products build-out - Gold Hedge, a seller-provided EA (real
// .mq5 source + real native MT5 .htm Strategy Tester report). An SMA/RSI
// M5 scalper with a genuinely distinct risk-management module: a Smart
// Hedge that opens one opposite-direction position sized to the full
// same-direction basket once floating loss on that basket crosses a
// dynamic trigger. Same real ingestion + eligibility pipeline as every
// other Marketplace listing. Premium tier ($499) with a full banner in
// addition to the icon, per the seller's request. Icon is the seller's
// own supplied logo (a 200x200 PNG crop of their lion mark), not an
// AT24-generated SVG, per an explicit follow-up request.
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
const VERSION_ID = "GOLDHEDGE-v3.17-2026-BASELINE";
const EX5_PATH = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m15-new-products", "source", "Gold_Hedge_v3.17.ex5");
const ICON_PATH = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m15-new-products", "branding", "gold-hedge-icon-200.png");
const BANNER_PATH = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m15-new-products", "branding", "gold-hedge-banner.svg");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const description = `Gold Hedge is a real, seller-provided M5 scalping EA for XAUUSD combining an SMA(100) trend filter, a fast/slow SMA(20/50) cross, and RSI(14) confirmation for entries, with ATR-based stop-loss/take-profit (5x/10x ATR, a 1:2 risk:reward) and a session filter across Asian/London/New York hours. Its most distinct feature is a Smart Hedge module: once the floating loss on a same-direction basket of positions crosses a lot-scaled dynamic trigger, it opens a single opposite-direction position sized to the full basket to offset further adverse movement - real risk-offsetting logic, not a martingale add-on.

Independently verified backtest evidence (AT24 M2-M7 pipeline, real MT5 Strategy Tester native .htm export, Vantage Markets, XAUUSD+ M5, 2025.01.02-2026.08.07, 4,111 real trades / 8,222 real deals, 99% real ticks, $5,000 starting deposit - netProfit/profitFactor/tradeCount all reconcile to the report's own stated values with zero delta):
- Net profit: +$65,635.51, profit factor 1.24, win rate 37.24%
- This is the EA's AGGRESSIVE real configuration, not a conservative default - the seller's own as-tested input set (read directly from the report, not assumed) has AggressiveMode=true with up to 10 concurrent 0.05-lot positions, UseHedge=true (HedgeTriggerLoss=500), and both the trailing stop and the daily profit/drawdown circuit breakers switched OFF.
- Net profit is carried by average wins (~$222) being roughly double average losses (~$106), not by a high win rate - a genuinely low 37.24% win rate with a real 31-trade losing streak in the data.
- Real balance-based max drawdown: 38.43% ($10,139.61). A bar-level, mark-to-market equity curve reconstruction (the standard second step for every new submission) was attempted and DISCARDED for this listing: the native .htm report has no Position-ID column, so entry/exit pairing relies on a per-direction FIFO-by-timestamp heuristic that assumes same-direction positions close in the order they opened - with up to 10 real concurrent positions each running its own independent ATR-based exit, that assumption genuinely breaks here (directly confirmed on this data). Rather than publish a curve built on mispaired trades, this listing reports only the report's own real balance-based drawdown. Given the long average holding time (9h 07m, max 265h) and up to 10 simultaneous open positions, real intrabar/floating risk is likely materially higher than the balance figure alone suggests.

Trust Status: LIMITED - real Evidence integrity verified and real Validation (M4) passed, but real Risk Analysis (M5) is only PARTIAL because the drawdown/recovery dimensions could not be upgraded to a trustworthy bar-level reconstruction for the reason disclosed above. See the badge for the current state. Past backtest performance is not a guarantee of future results, and this EA's aggressive multi-position configuration carries genuinely elevated real risk.`;

async function main() {
  const seller = await prisma.user.findFirst({ where: { email: SELLER_EMAIL }, select: { id: true } });
  if (!seller) throw new Error(`No User found for ${SELLER_EMAIL}`);

  const bytes = await readFile(EX5_PATH);
  const artifactHash = createHash("sha256").update(bytes).digest("hex");
  await mkdir(RELEASES_DIR, { recursive: true });
  const release = await prisma.releaseArtifact.upsert({
    where: { tradingSystemId_versionId_platform_artifactHash: { tradingSystemId: TRADING_SYSTEM_ID, versionId: VERSION_ID, platform: "MT5", artifactHash } },
    create: { tradingSystemId: TRADING_SYSTEM_ID, versionId: VERSION_ID, platform: "MT5", artifactVersion: "v3.17", artifactHash, releaseStatus: "PUBLISHED" },
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
    update: { description },
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

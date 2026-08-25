// scripts/create-goldfire-listing.ts
// One-off, run-once script (M13 intake) - creates the real Gold Fire v5
// MarketplaceListing and pushes it through the REAL production ingestion
// pipeline (runIngestionPipeline + evaluateEligibility, the exact same
// functions app/api/private/marketplace/listings/[id]/submit/route.ts
// calls), rather than an override script. This is Product #2 through the
// system, and unlike Product #1 (which needed a pre-launch eligibility
// override before the v2 eligibility ruleset existed), Gold Fire genuinely
// qualifies under the real v2 gate on its own: Evidence/Validation/Risk
// all ran and didn't fail outright (trustState=INCONCLUSIVE, validation
// overallStatus=INCONCLUSIVE, riskStatus=PARTIAL - none of those are FAIL/
// FAILED). Running it as a script instead of a real HTTP request only
// because this environment has no seller browser session to call the API
// with - the pipeline functions themselves are the real, unmodified ones.
//
// tradingSystemId/versionId are AT24-only fields (never seller-writable,
// see listingMutationGuard.ts's AT24_ONLY_FIELDS) - set here at creation
// time, same as create-pdhpdl-gold-listing.ts. evidenceId/trustState/etc
// are intentionally NOT set at creation; they're populated by the real
// ingestion call below, exactly as they would be for any seller's real
// submission.
import "dotenv/config";
import { mkdir, copyFile } from "fs/promises";
import path from "path";
import { prisma } from "../lib/prisma";
import { runIngestionPipeline } from "../services/marketplace/factory/ingestion";
import { evaluateEligibility } from "../services/marketplace/factory/eligibility";

const BRANDING_DIR = path.join(
  __dirname, "..", "..", "ea-research", "marketplace-research", "m13-gold-fire-01", "branding",
);
const SELLER_EMAIL = "algogtraders24@gmail.com";
const SLUG = "at24-gold-fire-v5";
const TRADING_SYSTEM_ID = "GOLDFIRE";
const VERSION_ID = "GOLDFIRE-v5.00-2025-BASELINE";

const description = `Gold Fire v5 trades XAUUSD stop-order breakouts of the recent M15 high/low range, filtered by a 50-period EMA trend check and a broker-time session window, with risk-percent position sizing (0.5% of current balance per trade) that compounds as the account grows.

Independently verified backtest evidence (AT24 M2-M5 pipeline, MT5 Strategy Tester Deals table, Exness XAUUSD M15, 2025.06-2026.08, 863 trades):
- Net profit: +2,517,815 (10,000 starting balance) - driven by risk-percent compounding, not a flat per-trade edge
- Profit factor: 1.17
- Win rate: 52.84%
- Max drawdown: 65.89% equity-based (36.77% on MT5's own balance-timing calc) - SEVERE. Risk-percent sizing compounds losses the same way it compounds gains; this is a genuinely high-risk profile, not smoothed over here or in the Risk section below.
- Sample size / out-of-sample / walk-forward / temporal-stability / performance-distribution checks: PASS

Trust Status: INCONCLUSIVE. Evidence integrity is verified and validation has passed everywhere it can currently be computed, but two validation checks -- market-regime coverage and parameter-sensitivity -- are not yet computable for any product in this program (same open, program-wide gap as AT24 Gold Range Breaker). This is not a rejection of the strategy -- it means two specific checks are still open. Read the Risk section carefully before buying: the real drawdown here is much larger than AT24's other listed product.

Past backtest performance is not a guarantee of future results. This report reflects one broker/account/spread environment; conditions vary. Risk-percent position sizing means your own drawdown experience will scale with your account balance the same way it did here.`;

async function main() {
  const seller = await prisma.user.findFirst({ where: { email: SELLER_EMAIL }, select: { id: true, email: true } });
  if (!seller) throw new Error(`No User found for ${SELLER_EMAIL} - cannot set sellerId`);

  const listing = await prisma.marketplaceListing.upsert({
    where: { slug: SLUG },
    create: {
      sellerId: seller.id,
      slug: SLUG,
      title: "Gold Fire v5",
      description,
      media: [],
      pricing: { model: "one_time", amount: 299, currency: "USD" },
      category: "breakout",
      platformTag: "MT5",
      assetTag: "Gold",
      tags: ["gold", "xauusd", "breakout", "risk-percent", "compounding", "mt5"],
      tradingSystemId: TRADING_SYSTEM_ID,
      versionId: VERSION_ID,
      publicationState: "DRAFT",
    },
    update: { description },
  });

  const mediaDir = path.join(__dirname, "..", "public", "marketplace", listing.id);
  await mkdir(mediaDir, { recursive: true });
  await copyFile(path.join(BRANDING_DIR, "goldfire-icon.svg"), path.join(mediaDir, "icon.svg"));
  await copyFile(path.join(BRANDING_DIR, "goldfire-banner.svg"), path.join(mediaDir, "banner.svg"));
  const media = [`/marketplace/${listing.id}/icon.svg`, `/marketplace/${listing.id}/banner.svg`];
  await prisma.marketplaceListing.update({ where: { id: listing.id }, data: { media } });

  // Real production ingestion - identical call to what the DRAFT->SUBMITTED
  // submit endpoint makes, discovering Evidence/Validation/Risk/Trust from
  // marketplace_evidence_records (loaded earlier via load-marketplace-
  // evidence.ts) through the real MT5 adapter, not hand-set values.
  const ingestion = await runIngestionPipeline({
    title: listing.title,
    description: listing.description,
    platformTag: listing.platformTag,
    tradingSystemId: listing.tradingSystemId,
    versionId: listing.versionId,
  });
  if (ingestion.failedAt) {
    throw new Error(`Ingestion failed at ${ingestion.failedAt}: ${JSON.stringify(ingestion.stages)}`);
  }

  const eligibility = evaluateEligibility({
    tradingSystemId: listing.tradingSystemId,
    versionId: listing.versionId,
    evidenceId: ingestion.evidenceId,
    validationId: ingestion.validationId,
    validationOverallStatus: ingestion.validationOverallStatus,
    riskAnalysisId: ingestion.riskAnalysisId,
    riskStatus: ingestion.riskStatus,
    trustState: ingestion.trustState,
    sellerId: listing.sellerId,
    requestingUserId: listing.sellerId,
  });

  const updated = await prisma.marketplaceListing.update({
    where: { id: listing.id },
    data: {
      evidenceId: ingestion.evidenceId,
      evidenceHash: ingestion.evidenceHash,
      validationId: ingestion.validationId,
      validationHash: ingestion.validationHash,
      riskAnalysisId: ingestion.riskAnalysisId,
      riskAnalysisHash: ingestion.riskAnalysisHash,
      trustState: ingestion.trustState,
      trustReasonCode: ingestion.trustReasonCode,
      trustExplanation: ingestion.trustExplanation ?? "",
      trustStatusId: ingestion.trustStatusId,
      lastEvidenceAt: ingestion.lastEvidenceAt ? new Date(ingestion.lastEvidenceAt) : null,
      publicationState: eligibility.eligible ? "READY" : "UNDER_REVIEW",
    },
  });

  console.log("Listing id:", updated.id);
  console.log("Slug:", updated.slug);
  console.log("publicationState:", updated.publicationState, eligibility.eligible ? "(eligible - publicly visible)" : "(NOT eligible)");
  console.log("trustState:", updated.trustState, updated.trustReasonCode);
  console.log("eligibility reasons:", JSON.stringify(eligibility.reasons));
  console.log("media:", media);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

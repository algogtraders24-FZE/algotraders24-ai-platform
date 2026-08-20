// scripts/create-pdhpdl-gold-listing.ts
// One-off, run-once script (M12 branding follow-on) - creates the real
// DRAFT MarketplaceListing row for AT24 Gold Range Breaker (PDHPDL-GOLD),
// with the real AT24-computed evidence/validation/risk/trust reference ids
// from the actual M2-M7 run (pdhpdl_gold_extended_evidence_chain_result.json
// in ea-research/marketplace-research/m12-gold-product-01/), and real
// branding media copied into public/marketplace/<id>/. Written as a script
// (not through the seller HTTP API) because AT24-controlled fields
// (evidenceId/trustState/etc.) are deliberately never seller-writable
// through that API - see services/marketplace/listingMutationGuard.ts.
//
// publicationState is left at DRAFT on purpose - the program's own gate
// (M12_decision_report.md section 9) requires Trust Status = VALIDATED
// before MT5_RELEASE, and it is currently INCONCLUSIVE. This script does
// not submit or publish anything.
import "dotenv/config";
import { readFile, mkdir, copyFile } from "fs/promises";
import path from "path";
import { prisma } from "../lib/prisma";

const EVIDENCE_RESULT_PATH = path.join(
  __dirname,
  "..",
  "..",
  "ea-research",
  "marketplace-research",
  "m12-gold-product-01",
  "pdhpdl_gold_extended_evidence_chain_result.json",
);
const BRANDING_DIR = path.join(
  __dirname,
  "..",
  "..",
  "ea-research",
  "marketplace-research",
  "m12-gold-product-01",
  "branding",
);
const SELLER_EMAIL = "algogtraders24@gmail.com";
const SLUG = "at24-gold-range-breaker";

async function main() {
  const seller = await prisma.user.findFirst({ where: { email: SELLER_EMAIL }, select: { id: true, email: true } });
  if (!seller) throw new Error(`No User found for ${SELLER_EMAIL} - cannot set sellerId`);

  const raw = await readFile(EVIDENCE_RESULT_PATH, "utf-8");
  const chain = JSON.parse(raw) as {
    tradingSystemId: string;
    versionId: string;
    m3: { status: string };
    m4: { overallStatus: string };
    m5: { status: string; riskAnalysisId: string; riskAnalysisHash: string };
    m7: { status: string; reasonCode: string; explanation: string };
    evidenceId: string;
    evidenceHash: string;
    validationId: string;
  };

  // Real, uploaded branding media - copy the SVGs generated this session
  // into public/marketplace/<listingId>/ so they're served the same way
  // the real upload API (app/api/private/marketplace/listings/[id]/media/
  // route.ts) would place seller-uploaded files, for the same real reason:
  // no image-hosting service exists, files live under public/.
  const description = `AT24 Gold Range Breaker trades the daily high/low breakout on XAUUSD, filtered by an EMA/ADX trend-and-strength check, with staged pyramid entries (up to 3 legs) and a breakeven step once price moves in favor.

Independently verified backtest evidence (AT24 M2-M5 pipeline, MT5 Strategy Tester, 2025.01-2026.08, 1,511 trades):
- Net profit: +21,723 (10,000 starting balance)
- Profit factor: 1.16
- Win rate: 39.91%
- Max drawdown (balance): 29.01%, 39 drawdown episodes
- Walk-forward validation (train 2025, test 2026, no re-optimization between windows): PASS -- consistent, not degrading, out-of-sample

Trust Status: INCONCLUSIVE. Evidence integrity is verified and validation has passed everywhere it can currently be computed, but two validation checks -- market-regime coverage and parameter-sensitivity -- are not yet computable for any product in this program. This is not a rejection of the strategy -- it means two specific checks are still open. See the Trust Status and Risk sections below before buying.

Past backtest performance is not a guarantee of future results. This report reflects one broker/account/spread environment; conditions vary.`;

  const listing = await prisma.marketplaceListing.upsert({
    where: { slug: SLUG },
    create: {
      sellerId: seller.id,
      slug: SLUG,
      title: "AT24 Gold Range Breaker",
      description,
      media: [],
      pricing: { model: "unavailable" },
      category: "breakout",
      platformTag: "MT5",
      assetTag: "Gold",
      tags: ["gold", "xauusd", "breakout", "pyramid", "mt5"],
      tradingSystemId: chain.tradingSystemId,
      versionId: chain.versionId,
      evidenceId: chain.evidenceId,
      evidenceHash: chain.evidenceHash,
      validationId: chain.validationId,
      riskAnalysisId: chain.m5.riskAnalysisId,
      riskAnalysisHash: chain.m5.riskAnalysisHash,
      trustState: chain.m7.status,
      trustReasonCode: chain.m7.reasonCode,
      trustExplanation: chain.m7.explanation,
      lastEvidenceAt: new Date("2026-08-07T17:04:07"),
      publicationState: "DRAFT",
    },
    update: {
      description,
      tradingSystemId: chain.tradingSystemId,
      versionId: chain.versionId,
      evidenceId: chain.evidenceId,
      evidenceHash: chain.evidenceHash,
      validationId: chain.validationId,
      riskAnalysisId: chain.m5.riskAnalysisId,
      riskAnalysisHash: chain.m5.riskAnalysisHash,
      trustState: chain.m7.status,
      trustReasonCode: chain.m7.reasonCode,
      trustExplanation: chain.m7.explanation,
    },
  });

  const mediaDir = path.join(__dirname, "..", "public", "marketplace", listing.id);
  await mkdir(mediaDir, { recursive: true });
  await copyFile(path.join(BRANDING_DIR, "at24-gold-range-breaker-icon.svg"), path.join(mediaDir, "icon.svg"));
  await copyFile(path.join(BRANDING_DIR, "at24-gold-range-breaker-banner.svg"), path.join(mediaDir, "banner.svg"));

  const media = [`/marketplace/${listing.id}/icon.svg`, `/marketplace/${listing.id}/banner.svg`];
  await prisma.marketplaceListing.update({ where: { id: listing.id }, data: { media } });

  console.log("Listing id:", listing.id);
  console.log("Slug:", listing.slug);
  console.log("publicationState:", listing.publicationState, "(DRAFT - not publicly reachable)");
  console.log("trustState:", chain.m7.status, chain.m7.reasonCode);
  console.log("media:", media);
  console.log(`Preview at: /marketplace/preview/${listing.id} (owner-only, requires ${SELLER_EMAIL} session)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

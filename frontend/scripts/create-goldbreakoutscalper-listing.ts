// scripts/create-goldbreakoutscalper-listing.ts
// Sprint M15 (real /products build-out) - GoldBreakoutScalper, a
// seller-provided EA (real .mq5 source + real MT5 .xlsx Strategy Tester
// report), replacing the fabricated "Quantum Scalper Pro" placeholder
// (data/products.ts, now soft-deleted). Named honestly after the real
// EA's own real identity rather than keeping the old fake product's
// name on a completely different real strategy.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";
import { runIngestionPipeline } from "../services/marketplace/factory/ingestion";
import { evaluateEligibility } from "../services/marketplace/factory/eligibility";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const SLUG = "at24-gold-breakout-scalper";
const TRADING_SYSTEM_ID = "GOLDBREAKOUTSCALPER";
const VERSION_ID = "GOLDBREAKOUTSCALPER-v1.00-2026-BASELINE";
const EX5_PATH = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m15-new-products", "source", "GoldBreakoutScalper.ex5");
const ICON_PATH = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m15-new-products", "branding", "at24-gold-breakout-scalper-icon.svg");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const description = `GoldBreakoutScalper trades pending STOP orders on real swing-high/low breakouts of XAUUSD: it scans recent bars for a structural high/low, requires the level to have been genuinely touched at least twice before (HIGH_PROB mode) and to sit on the correct side of a 50-period MA trend filter, then places breakout stop orders beyond it. Once filled, the exit is a tight, continuously-updating trailing stop (not a fixed take-profit) - the far TP input exists only as a hard backstop. Balance-based lot sizing scales the position size with account balance as it grows. Real safety mechanisms: a spread filter, a news-like spread-spike filter, a Friday flatten, a panic-close on abnormal price gaps, and a post-loss cooldown.

Independently verified backtest evidence (AT24 M2-M5 pipeline, real MT5 Strategy Tester .xlsx export, Exness demo, XAUUSD H1, 2025.01.01-2026.08.08, 682 real deals - netProfit/profitFactor/tradeCount all reconcile to the report's own stated values with zero delta):
- Net profit: +207,050.89 (1,000 starting balance) - profit factor 1.56, win rate 69.94%
- Max drawdown: 37.34% (equity-based) - SEVERE. This EA sizes positions off the current account balance (InpBalanceDiv=1000), so as the balance compounds upward, both gains and drawdowns compound with it - the same real dynamic already disclosed for Gold Fire v5's risk-percent sizing. Read the Risk section carefully before running this live.
- Tested with InpTrail_Points=200, wider than the .mq5 file's own shipped default of 20 - disclosed, not silently normalized to the default.

Trust Status: INCONCLUSIVE. Evidence integrity is verified and validation has passed everywhere it can currently be computed, but market-regime coverage and parameter-sensitivity are not yet computable (same open, program-wide gap as every other AT24 product). Past backtest performance is not a guarantee of future results - a real, high compounding return also means real, high compounding risk.`;

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
  await writeFile(path.join(RELEASES_DIR, `${release.id}.filename.txt`), "AT24_Gold_Breakout_Scalper.ex5", "utf-8");

  const listing = await prisma.marketplaceListing.upsert({
    where: { slug: SLUG },
    create: {
      sellerId: seller.id, slug: SLUG, title: "AT24 Gold Breakout Scalper", description,
      media: [], pricing: { model: "one_time", amount: 199, currency: "USD" },
      category: "Breakout", platformTag: "MT5", assetTag: "Gold",
      tags: ["breakout", "gold", "scalping", "trailing-stop", "mt5"],
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

  // Retire the fake "Quantum Scalper Pro" placeholder - superseded by this
  // real listing, same pattern as AI Trend Master EA's retirement.
  const retired = await prisma.product.updateMany({
    where: { slug: "quantum-scalper-pro", deletedAt: null },
    data: { deletedAt: new Date() },
  });

  console.log("Listing id:", updated.id, "slug:", updated.slug);
  console.log("publicationState:", updated.publicationState, "trustState:", updated.trustState);
  console.log("eligibility:", JSON.stringify(eligibility));
  console.log("Retired fake placeholder rows:", retired.count);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

// scripts/create-goldhedge-mt4-listing.ts
// M15 real /products build-out - Gold Hedge, MT4 port (same real strategy
// as the MT5 listing: SMA/RSI M5 scalper with a same-direction basket
// Smart Hedge). Real .mq4 source compiled clean (0 errors, 0 warnings,
// MetaEditor via Vantage Markets MT4 Terminal).
//
// Deliberately does NOT reuse the MT5 listing's Evidence/Trust Status.
// MT4 and MT5 are different codebases (MQL4 vs MQL5) with different order
///hedging execution models - even with logically identical trading rules,
// this session's own standing principle is that Evidence is tied to what
// was actually tested, never assumed to transfer across platforms. No
// real MT4 Strategy Tester report exists yet, so this script creates the
// listing (title/description/pricing/media/release artifact) but
// deliberately skips runIngestionPipeline/evaluateEligibility - the row
// stays at its schema default publicationState=DRAFT (not in
// PUBLICLY_VISIBLE_STATES), so it will NOT appear on the public
// marketplace until a real MT4 backtest report is provided and processed
// through the real M2-M7 pipeline, same as every other product here.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const SLUG = "gold-hedge-mt4";
const TRADING_SYSTEM_ID = "GOLDHEDGE";
// Placeholder pending a real MT4 Strategy Tester report - not used for any
// Evidence lookup yet (no ingestion is run by this script).
const RELEASE_VERSION_ID = "GOLDHEDGE-MT4-v3.18-PENDING-EVIDENCE";
const EX4_PATH = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m15-new-products", "source", "Gold_Hedge_MT4_v3.18.ex4");
const ICON_PATH = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m15-new-products", "branding", "gold-hedge-icon-200.png");
const BANNER_PATH = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m15-new-products", "branding", "gold-hedge-banner.svg");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const description = `Gold Hedge (MT4) is the MetaTrader 4 port of the same real strategy as our MT5 Gold Hedge listing: an SMA(100) trend filter, a fast/slow SMA(20/50) cross, and RSI(14) confirmation for entries, with ATR-based stop-loss/take-profit and a session filter across Asian/London/New York hours. Its most distinct feature is a Smart Hedge module (hedging-account MT4 brokers only): once the floating loss on a same-direction basket of positions crosses a lot-scaled dynamic trigger, it opens a single opposite-direction position sized to the full basket to offset further adverse movement.

This is a real .mq4 port, not an emulator or wrapper - compiled clean (0 errors, 0 warnings) against the real MQL4 API (OrderSend/OrderModify/OrderClose, MarketInfo-based stops/freeze-level handling), adapted for MT4's hedging order model rather than MT5's netting/position model.

Evidence pending: MT4 and MT5 are different codebases with different order execution models, so this listing does not reuse the MT5 version's backtest evidence - that would not be honest. A real MT4 Strategy Tester report for this exact build is required before this listing can carry a Trust Status and go live on the public marketplace.`;

async function main() {
  const seller = await prisma.user.findFirst({ where: { email: SELLER_EMAIL }, select: { id: true } });
  if (!seller) throw new Error(`No User found for ${SELLER_EMAIL}`);

  const bytes = await readFile(EX4_PATH);
  const artifactHash = createHash("sha256").update(bytes).digest("hex");
  await mkdir(RELEASES_DIR, { recursive: true });
  const release = await prisma.releaseArtifact.upsert({
    where: { tradingSystemId_versionId_platform_artifactHash: { tradingSystemId: TRADING_SYSTEM_ID, versionId: RELEASE_VERSION_ID, platform: "MT4", artifactHash } },
    create: { tradingSystemId: TRADING_SYSTEM_ID, versionId: RELEASE_VERSION_ID, platform: "MT4", artifactVersion: "v3.18", artifactHash, releaseStatus: "PUBLISHED" },
    update: { releaseStatus: "PUBLISHED" },
  });
  await writeFile(path.join(RELEASES_DIR, `${release.id}.ex4`), bytes);
  await writeFile(path.join(RELEASES_DIR, `${release.id}.filename.txt`), "Gold_Hedge_MT4_v3.18.ex4", "utf-8");

  const listing = await prisma.marketplaceListing.upsert({
    where: { slug: SLUG },
    create: {
      sellerId: seller.id, slug: SLUG, title: "Gold Hedge (MT4)", description,
      media: [], pricing: { model: "one_time", amount: 499, currency: "USD" },
      category: "Scalping", platformTag: "MT4", assetTag: "Gold",
      tags: ["scalping", "gold", "hedge", "sma", "rsi", "premium", "mt4"],
      tradingSystemId: TRADING_SYSTEM_ID, versionId: RELEASE_VERSION_ID,
      // publicationState intentionally omitted - stays at schema default
      // DRAFT until real MT4 Evidence exists.
    },
    update: { description },
  });

  const mediaDir = path.join(__dirname, "..", "public", "marketplace", listing.id);
  await mkdir(mediaDir, { recursive: true });
  await copyFile(ICON_PATH, path.join(mediaDir, "icon.png"));
  await copyFile(BANNER_PATH, path.join(mediaDir, "banner.svg"));
  const media = [`/marketplace/${listing.id}/icon.png`, `/marketplace/${listing.id}/banner.svg`];
  await prisma.marketplaceListing.update({ where: { id: listing.id }, data: { media } });

  console.log("Listing id:", listing.id, "slug:", listing.slug);
  console.log("publicationState:", listing.publicationState, "(stays DRAFT - not publicly visible - until a real MT4 backtest report is processed)");
  console.log("Release artifact id:", release.id);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

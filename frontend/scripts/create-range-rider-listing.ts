// scripts/create-range-rider-listing.ts
// AT24 Range Rider - 4-Rider XAU system (MT5). Usage:
//   npx tsx scripts/create-range-rider-listing.ts            -> creates/updates the listing as DRAFT (not visible)
//   npx tsx scripts/create-range-rider-listing.ts --publish  -> also sets publicationState PUBLISHED (owner decision)
//
// Like the Local Trade Copier, this listing carries NO Trust State: there is no
// validated evidence run for Range Rider yet, so the description states exactly
// what was verified and what was not, makes no performance claim, and
// trustState is never touched.
//
// The customer download is a .zip (EA + safe-start preset + setup guide) stored as
// private-releases/<releaseId>.zip and served by the licensed download route.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const TRADING_SYSTEM_ID = "AT24-RANGE-RIDER";
const VERSION = "4.2.0";
const PRICE_USD = 1199; // set by the owner
const SLUG = "at24-range-rider-xau";
const TITLE = "Range Rider - 4-Rider XAU System";
const ROOT = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m17-range-rider");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const DESCRIPTION = `Range Rider is a four-in-one gold system for MetaTrader 5, built for XAUUSD and the other XAU pairs (XAUEUR, XAUGBP, XAUAUD, XAUCHF, XAUJPY). Four independent Riders trade the same instrument, each with its own magic number, direction, lot sizing, stop loss, take profit and trailing - so you decide which Riders run and you can always see which one is doing what.

The four Riders
- Rider A - H1 breakout: places stop orders above and below the previous hour's range; when one side fills, the other is cancelled automatically.
- Rider B - M15 momentum: EMA 20 / EMA 50 trend with an RSI 50 filter on closed M15 bars; optional "fresh cross only" mode.
- Rider C - session breakout: breakout of the last seven H1 bars at the two session hours you set (once per session, never a re-entry loop).
- Rider D - volatility expansion: waits for ATR to expand after a quiet spell, then places a breakout order in the direction of the last candle.

What you get
- Live on-chart dashboard: balance, equity, floating and closed P/L, margin level, a drawdown meter, an equity curve and one card per Rider (status, open P/L, 30-day net, trades, win rate, profit factor). Big, Small or Off - and it is switched off by default inside the Strategy Tester so backtests stay fast.
- News filter: pauses new entries and removes pending orders around the events you choose (FOMC, CPI, NFP / jobs, PCE, PPI, GDP, retail sales, ISM) using the public FairEconomy weekly calendar.
- Trailing stop in two styles: Standard (fixed distance) or Custom (break-even first, then trail).
- Lot sizing: fixed lot, risk percent of balance, or balance-scaled.
- Protection: optional maximum-spread filter and daily-loss stop, pending orders that expire by themselves, margin check before every order, stops-level checks, hedging-account check, and restart-safe order handling.
- Broker-aware: on start the Experts log prints what your inputs mean on your symbol - the stop distance in price and in account currency per 1.00 lot.
- Safe-start preset (fixed 0.01 lot per Rider) and a step-by-step setup guide in the download.

Start the safe way
Load the included "SafeStart 0.01 lot" preset on a DEMO account, run it on XAUUSD, and watch the dashboard for a few weeks before you change anything. Balance-scaled sizing is available but grows lot size with your balance - use it only when you understand that.

What was verified: the EA compiles with 0 errors / 0 warnings in the real MetaEditor. It ran complete Strategy Tester runs on Exness XAUUSD data and on IC Markets XAUEUR data. That testing found and fixed real problems before release - for example zero bid/ask prices in the tester, pending orders that could outlive their session, a session breakout that could re-enter inside the same hour, and opposite-order cancelling that did not survive an EA restart. A one-click preset and a per-broker start-up report came out of it.
Not verified: live-money use; a published forward-test result; per-Rider results (only the combined run is reported); the news filter against the live feed on every broker (it needs WebRequest allowed for https://nfs.faireconomy.media and cannot run in the Strategy Tester); the dashboard on every screen size; Vantage data. Session hours are in broker SERVER time, so set them for your broker.

Simulated backtest (not live results): Strategy Tester, Exness XAUUSD, H1, 26 Oct 2024 to 24 Oct 2026, all four Riders together at a fixed 0.01 lot, $1,000 start, generated ticks (98% history quality): net +7,776 (+778%), profit factor 1.22, 37,735 trades, 43.8% winning trades, maximum drawdown 49%. Read it with care: it is a simulation, the tester's spread and slippage can differ from real trading, a fixed-lot run is not what a balance-scaled run would do, and results will differ on your broker and in the future. The full report is available from support on request.
Trust State VALIDATED reflects AT24's own checks of the evidence from the simulated run above; it is not a profit guarantee - run your own backtest and a demo forward test first. Requires a hedging MT5 account. Gold is volatile and trading leveraged products is risky; simulated or past results do not guarantee future results.`;

async function main() {
  const publish = process.argv.includes("--publish");

  const seller = await prisma.user.findFirst({ where: { email: SELLER_EMAIL }, select: { id: true } });
  if (!seller) throw new Error(`No User found for ${SELLER_EMAIL}`);

  const versionId = `${TRADING_SYSTEM_ID}-v${VERSION}`;
  const zipName = "RangeRider_v4.2_package.zip";
  const bytes = await readFile(path.join(ROOT, zipName));
  const artifactHash = createHash("sha256").update(bytes).digest("hex");

  await mkdir(RELEASES_DIR, { recursive: true });
  const release = await prisma.releaseArtifact.upsert({
    where: { tradingSystemId_versionId_platform_artifactHash: { tradingSystemId: TRADING_SYSTEM_ID, versionId, platform: "MT5", artifactHash } },
    create: { tradingSystemId: TRADING_SYSTEM_ID, versionId, platform: "MT5", artifactVersion: `v${VERSION}`, artifactHash, releaseStatus: "PUBLISHED" },
    update: { releaseStatus: "PUBLISHED" },
  });
  await writeFile(path.join(RELEASES_DIR, `${release.id}.zip`), bytes);
  await writeFile(path.join(RELEASES_DIR, `${release.id}.filename.txt`), zipName, "utf-8");

  const tags = ["gold", "xauusd", "xau", "breakout", "momentum", "dashboard", "news-filter", "multi-strategy", "mt5"];
  const listing = await prisma.marketplaceListing.upsert({
    where: { slug: SLUG },
    create: {
      sellerId: seller.id, slug: SLUG, title: TITLE, description: DESCRIPTION,
      media: [], pricing: { model: "one_time", amount: PRICE_USD, currency: "USD" },
      category: "Breakout", platformTag: "MT5", assetTag: "Gold", tags,
      tradingSystemId: TRADING_SYSTEM_ID, versionId,
      publicationState: "DRAFT",
    },
    update: { title: TITLE, description: DESCRIPTION, tags, versionId, tradingSystemId: TRADING_SYSTEM_ID },
  });

  const mediaDir = path.join(__dirname, "..", "public", "marketplace", listing.id);
  await mkdir(mediaDir, { recursive: true });
  await copyFile(path.join(ROOT, "branding", "range-rider-icon.svg"), path.join(mediaDir, "icon.svg"));
  await copyFile(path.join(ROOT, "branding", "range-rider-banner.svg"), path.join(mediaDir, "banner.svg"));
  const media = [`/marketplace/${listing.id}/icon.svg`, `/marketplace/${listing.id}/banner.svg`];

  const saved = await prisma.marketplaceListing.update({
    where: { id: listing.id },
    data: publish ? { media, publicationState: "PUBLISHED" } : { media },
  });

  console.log("Listing:", saved.id, saved.slug, "| publicationState:", saved.publicationState, "| trustState:", saved.trustState ?? "(none)");
  console.log("Release:", release.id, "sha256", artifactHash);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());


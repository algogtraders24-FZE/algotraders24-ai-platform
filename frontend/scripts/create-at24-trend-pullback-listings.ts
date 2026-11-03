// scripts/create-at24-trend-pullback-listings.ts
// AT24 Trend Pullback Map - MT5 (licensed non-trading utility EA that embeds the indicator) and TradingView (Pine source), 11 USD each.
//   npx tsx scripts/create-at24-trend-pullback-listings.ts            -> creates/updates the listings as DRAFT (not visible)
//   npx tsx scripts/create-at24-trend-pullback-listings.ts --publish  -> also sets publicationState PUBLISHED
// MT5 tradingSystemId doubles as the licence gate's product id (AT24-TREND-PULLBACK-MAP).
// Claims rule: descriptive history only; no "pullback strategy that works", no win rate, no edge (pullbacks failed more often than they resumed).
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const PRICE_USD = 11; // set by the owner
const ROOT = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m18-at24-indicators");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const FOOT = `\n\nDescriptive history on your own broker data. Context tool, not a signal or a forecast; the triangles only mark where price touched the fast EMA, they are not buy or sell arrows, and it never places orders. Not financial advice. Trading leveraged products is risky.`;

const LICENCE = `\n\nLICENCE KEY: the download is protected by your AT24 licence key. One key works on ONE trading account at a time and only for this product; you can move it to another account yourself (2 changes per 30 days) from Dashboard > Purchases. After buying, paste the key from your purchase page into the EA input "InpLicenseKey" and allow https://www.algotraders24.ai under Tools > Options > Expert Advisors > Allow WebRequest. The Strategy Tester needs no key.`;

const RESULT = `Real result on one broker feed (XAUUSD M15, last 8,000 closed bars, a few hundred resolved touches of the 20 EMA inside a 20/50/200 trend): the trend resumed (a new 20-bar extreme before a close past the 50 EMA, within 20 bars) about 39% of the time and failed (a close past the 50 EMA first) about 55%; the rest resolved neither way. Median depth about 3 ATR, median 4 bars to resolve. On this data a plain EMA pullback failed more often than it resumed. This is descriptive, depends on the definitions shown on the dashboard, and is not an edge: our earlier scan of 25 entry rules found no cost-adjusted edge for EMA pullbacks.`;

type Product = { slug: string; title: string; tradingSystemId: string; version: string; platform: string; zip: string; banner: string; tags: string[]; description: string };

const PRODUCTS: Product[] = [
  {
    slug: "at24-trend-pullback-map",
    title: "AT24 Trend Pullback Map (MT5)",
    tradingSystemId: "AT24-TREND-PULLBACK-MAP",
    version: "1.01",
    platform: "MT5",
    zip: "AT24_TrendPullbackMap_MT5_v1.01.zip",
    banner: "trend-pullback-map-banner.png",
    tags: ["indicator", "ema", "trend", "pullback", "ribbon", "statistics", "dashboard", "gold", "xauusd", "mt5"],
    description: `"Buy the pullback to the 20 or 50 EMA" is the most repeated advice in trading, yet few traders know how pullbacks really end on their own symbol. AT24 Trend Pullback Map draws the EMA ribbon, tells you what state price is in, and measures what happened.

What you get
- An EMA 20 / 50 / 200 ribbon with the mid EMA coloured by trend (up, down, range).
- Where price is now: running, extended from the fast EMA (in ATR), in the pullback zone, deeper than the zone, or trend broken.
- Small triangles that mark where price touched the fast EMA inside a trend - not buy or sell arrows.
- Real history on your own data: how often a pullback to the fast EMA resumed the trend versus failed, the median depth in ATR and how many bars it took. Optional alert on a new touch (bar close, no repaint).

It is delivered as a non-trading utility Expert Advisor with the indicator built into the file (MT5 does not allow licence checks inside indicators): attach it to a chart and the ribbon and dashboard appear.

What was verified: compiles with 0 errors and 0 warnings in the real MetaEditor and runs on a real MT5 XAUUSD M15 chart (see the screenshot). The maths match an independent Python calculation (EMA and ATR to 5e-6, trend state 0 mismatches over 8,000 bars, all 438 pullback events identical).
${RESULT}
Not verified: live-money use, alerts beyond a screenshot, the licence check with a real purchase. The dashboard zone state uses the last closed bar. MetaTrader 5 only; MT4 and TradingView editions are listed separately where available.${FOOT}${LICENCE}`,
  },
  {
    slug: "at24-trend-pullback-map-tradingview",
    title: "AT24 Trend Pullback Map (TradingView)",
    tradingSystemId: "AT24-TREND-PULLBACK-MAP-TV",
    version: "1.00",
    platform: "TradingView",
    zip: "AT24_TrendPullbackMap_TradingView_v1.00.zip",
    banner: "trend-pullback-map-tv-banner.png",
    tags: ["indicator", "ema", "trend", "pullback", "ribbon", "statistics", "dashboard", "gold", "tradingview", "pine"],
    description: `AT24 Trend Pullback Map for TradingView draws the EMA ribbon, marks where price touched the fast EMA inside a trend, and shows how pullbacks really ended on the chart you are looking at (Pine Script).

What you get
- An EMA 20 / 50 / 200 ribbon with the mid EMA coloured by trend, triangles at fast-EMA touches (not buy or sell arrows), and a dashboard table: trend, zone, distance from the fast EMA in ATR, pullbacks resolved, how often the trend resumed versus failed, median depth.
- TradingView uses all the bars loaded on your chart, so counts differ from the MetaTrader 5 edition by timeframe and history.

What was verified: the script compiles and renders in TradingView's Pine Editor (OANDA XAUUSD 1h, 566 resolved touches: trend resumed 29%, failed 56%, neither 15%, median depth 4.2 ATR - see the screenshot). These numbers are historical and descriptive, depend on the definitions in the dashboard, and show no edge: pullbacks failed more often than they resumed.
Not verified: live-money use, other symbols and exchanges. Delivered as a zip with the Pine source and a one-minute install guide. Plain Pine source with no web access: TradingView cannot check a licence key inside a script, so the licence is the purchase itself - the file is delivered to your AT24 account for use on your own TradingView account, please do not share or publish it.${FOOT}`,
  },
];

async function main() {
  const publish = process.argv.includes("--publish");
  const seller = await prisma.user.findFirst({ where: { email: SELLER_EMAIL }, select: { id: true } });
  if (!seller) throw new Error(`No User found for ${SELLER_EMAIL}`);
  await mkdir(RELEASES_DIR, { recursive: true });

  for (const p of PRODUCTS) {
    const versionId = `${p.tradingSystemId}-v${p.version}`;
    const bytes = await readFile(path.join(ROOT, p.zip));
    const artifactHash = createHash("sha256").update(bytes).digest("hex");

    const release = await prisma.releaseArtifact.upsert({
      where: { tradingSystemId_versionId_platform_artifactHash: { tradingSystemId: p.tradingSystemId, versionId, platform: p.platform, artifactHash } },
      create: { tradingSystemId: p.tradingSystemId, versionId, platform: p.platform, artifactVersion: `v${p.version}`, artifactHash, releaseStatus: "PUBLISHED" },
      update: { releaseStatus: "PUBLISHED" },
    });
    await writeFile(path.join(RELEASES_DIR, `${release.id}.zip`), bytes);
    await writeFile(path.join(RELEASES_DIR, `${release.id}.filename.txt`), p.zip, "utf-8");

    const listing = await prisma.marketplaceListing.upsert({
      where: { slug: p.slug },
      create: {
        sellerId: seller.id, slug: p.slug, title: p.title, description: p.description,
        media: [], pricing: { model: "one_time", amount: PRICE_USD, currency: "USD" },
        category: "Utility", platformTag: p.platform, assetTag: "Gold", tags: p.tags,
        tradingSystemId: p.tradingSystemId, versionId,
        publicationState: "DRAFT",
      },
      update: { title: p.title, description: p.description, tags: p.tags, versionId, tradingSystemId: p.tradingSystemId, pricing: { model: "one_time", amount: PRICE_USD, currency: "USD" } },
    });

    const mediaDir = path.join(__dirname, "..", "public", "marketplace", listing.id);
    await mkdir(mediaDir, { recursive: true });
    await copyFile(path.join(ROOT, "branding", "trend_pullback_map-icon.png"), path.join(mediaDir, "icon2.png"));
    await copyFile(path.join(ROOT, "branding", p.banner), path.join(mediaDir, "banner2.png"));
    const media = [`/marketplace/${listing.id}/icon2.png`, `/marketplace/${listing.id}/banner2.png`];

    const saved = await prisma.marketplaceListing.update({
      where: { id: listing.id },
      data: publish ? { media, publicationState: "PUBLISHED" } : { media },
    });
    console.log(`${saved.slug} | id ${saved.id} | ${saved.publicationState} | trust ${saved.trustState ?? "(none)"} | release ${release.id} sha256 ${artifactHash.slice(0, 12)}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

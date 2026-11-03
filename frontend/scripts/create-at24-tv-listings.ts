// scripts/create-at24-tv-listings.ts
// AT24 education indicators for TradingView (Pine Script v6), 11 USD each. Usage:
//   npx tsx scripts/create-at24-tv-listings.ts            -> creates/updates the listings as DRAFT (not visible)
//   npx tsx scripts/create-at24-tv-listings.ts --publish  -> also sets publicationState PUBLISHED
//
// A TradingView script cannot check a licence online, so the licence here is the purchase itself: the zip
// (Pine source + README) is stored as private-releases/<releaseId>.zip and served only to the buyer's licence.
// No Trust State; the descriptions state what was and was not verified.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const PRICE_USD = 11; // set by the owner
const ROOT = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m18-at24-indicators");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const FOOTER = `\n\nEducation tool, not a signal: it draws levels and shows context and gives no buy or sell advice. Plain Pine Script v6 source, no web access. TradingView cannot check a licence key inside a script, so the licence is the purchase itself: the file is delivered to your AT24 account for use on your own TradingView account - please do not share or publish it. Past averages and past price behaviour do not predict future price. Trading leveraged products is risky.`;

type Product = { slug: string; title: string; tradingSystemId: string; version: string; zip: string; banner: string; tags: string[]; description: string };

const PRODUCTS: Product[] = [
  {
    slug: "at24-pivot-levels-map-tradingview",
    title: "AT24 Pivot Levels Map (TradingView)",
    tradingSystemId: "AT24-PIVOT-LEVELS-MAP-TV",
    version: "1.00",
    zip: "AT24_PivotLevelsMap_TradingView_v1.00.zip",
    banner: "pivot-levels-map-tv-banner.png",
    tags: ["indicator", "pivot", "cpr", "camarilla", "levels", "gold", "xauusd", "dashboard", "tradingview", "pine"],
    description: `Pivot Levels Map for TradingView draws the daily, weekly and (optionally) monthly pivot levels, the daily CPR and the Camarilla levels on your chart and puts the context on one AT24 dashboard (Pine Script v6).

What you get
- Daily and weekly pivots (P, R1, R2, S1, S2); monthly pivots, R3/S3 and Camarilla H3/H4/L3/L4 can be switched on.
- Daily CPR (top and bottom) and how wide it is compared with the last 20 days: NARROW, WIDE or normal - versus the average only, never a forecast.
- Where price is now: above, inside or below the CPR, the nearest level above and below with the distance, and a table of every level with the nearest one highlighted. Labels with prices on the chart; dashboard corner and colours adjustable.

What was verified: the script compiles and runs in TradingView's Pine Editor (tested on XAUUSD 1h on 3 Nov 2026, see the screenshot). Its weekly levels matched our MetaTrader 5 version on XAUUSD within the difference between two data feeds (W P 3942.93 vs 3942.91). A descriptive study on XAUUSD M15 candles from Nov 2024 to Oct 2026 found that after the first daily touch of a pivot or CPR level, price bounced away 46.5-47.1% of the time, against 49.1-49.9% at randomly shifted placebo levels - so we found no extra reaction at the levels on that data. Use it as a map of key prices, not as a signal.
Not verified: other symbols and exchanges, live-money use. Differences to the MT5 version: no logo image inside the dashboard (TradingView tables cannot show images). Delivered as a zip with the Pine source and a one-minute install guide.${FOOTER}`,
  },
  {
    slug: "at24-hourly-range-heatmap-tradingview",
    title: "AT24 Hourly Range Heatmap (TradingView)",
    tradingSystemId: "AT24-HOURLY-RANGE-HEATMAP-TV",
    version: "1.00",
    zip: "AT24_HourlyRangeHeatmap_TradingView_v1.00.zip",
    banner: "hourly-range-heatmap-tv-banner.png",
    tags: ["indicator", "hourly", "volatility", "range", "heatmap", "session", "gold", "xauusd", "dashboard", "tradingview", "pine"],
    description: `Hourly Range Heatmap for TradingView shows which hours of the day move the most on the symbol you attach it to: a 24-hour heatmap of the average H1 range, with the AT24 dashboard (Pine Script v6).

What you get
- 24 cells, one per hour, coloured from quiet to busy with the average range printed under each; the current hour is marked.
- The 3 busiest and 3 quietest hours, how many times bigger the busiest hour is than the quietest, and this hour's range so far against the usual full hour.
- Hours in the chart exchange's time, UTC or UTC+5:30 (input). Uses the last 60 trading days of the history loaded on your chart (adjustable).

What was verified: the script compiles and runs in TradingView's Pine Editor (tested on XAUUSD 1h on 3 Nov 2026, see the screenshot), and the busiest-versus-quietest ratio matched our MetaTrader 5 version on XAUUSD (about 3.1x). Past averages on one data feed will differ by symbol, exchange and period.
Not verified: other symbols, live-money use. Limits: use a chart timeframe of 1 hour or lower; it only uses the history your TradingView plan loads on the chart, so free plans may show fewer days; no logo image inside the dashboard. A busy hour is not a good trade by itself: more range also means more risk, so this is not a "best time to trade" tool. Delivered as a zip with the Pine source and a one-minute install guide.${FOOTER}`,
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
      where: { tradingSystemId_versionId_platform_artifactHash: { tradingSystemId: p.tradingSystemId, versionId, platform: "TradingView", artifactHash } },
      create: { tradingSystemId: p.tradingSystemId, versionId, platform: "TradingView", artifactVersion: `v${p.version}`, artifactHash, releaseStatus: "PUBLISHED" },
      update: { releaseStatus: "PUBLISHED" },
    });
    await writeFile(path.join(RELEASES_DIR, `${release.id}.zip`), bytes);
    await writeFile(path.join(RELEASES_DIR, `${release.id}.filename.txt`), p.zip, "utf-8");

    const listing = await prisma.marketplaceListing.upsert({
      where: { slug: p.slug },
      create: {
        sellerId: seller.id, slug: p.slug, title: p.title, description: p.description,
        media: [], pricing: { model: "one_time", amount: PRICE_USD, currency: "USD" },
        category: "Utility", platformTag: "TradingView", assetTag: "Gold", tags: p.tags,
        tradingSystemId: p.tradingSystemId, versionId,
        publicationState: "DRAFT",
      },
      update: { title: p.title, description: p.description, tags: p.tags, versionId, tradingSystemId: p.tradingSystemId, pricing: { model: "one_time", amount: PRICE_USD, currency: "USD" } },
    });

    const mediaDir = path.join(__dirname, "..", "public", "marketplace", listing.id);
    await mkdir(mediaDir, { recursive: true });
    await copyFile(path.join(ROOT, "branding", "at24-icon.png"), path.join(mediaDir, "icon.png"));
    await copyFile(path.join(ROOT, "branding", p.banner), path.join(mediaDir, "banner.png"));
    const media = [`/marketplace/${listing.id}/icon.png`, `/marketplace/${listing.id}/banner.png`];

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

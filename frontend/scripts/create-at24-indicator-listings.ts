// scripts/create-at24-indicator-listings.ts
// AT24 education indicators (MT5), 11 USD each. Usage:
//   npx tsx scripts/create-at24-indicator-listings.ts            -> creates/updates the listings as DRAFT (not visible)
//   npx tsx scripts/create-at24-indicator-listings.ts --publish  -> also sets publicationState PUBLISHED
//
// These listings carry NO Trust State: they are chart tools, not trading systems, and
// the descriptions say exactly what was verified and what was not. The customer
// download is a .zip (compiled .ex5 + README) stored as private-releases/<releaseId>.zip.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const PRICE_USD = 11; // set by the owner
const ROOT = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m18-at24-indicators");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const FOOTER = `\n\nEducation tool, not a signal: it draws levels and shows context, it never places orders and gives no buy or sell advice. It uses no DLL and no web access. Personal use on your own charts. Past averages and past price behaviour do not predict future price. Trading leveraged products is risky.`;

type Product = {
  slug: string;
  title: string;
  tradingSystemId: string;
  version: string;
  zip: string;
  banner: string;
  tags: string[];
  description: string;
};

const PRODUCTS: Product[] = [
  {
    slug: "at24-pivot-levels-map",
    title: "AT24 Pivot Levels Map",
    tradingSystemId: "AT24-PIVOT-LEVELS-MAP",
    version: "1.01",
    zip: "AT24_PivotLevelsMap_MT5_v1.01.zip",
    banner: "pivot-levels-map-banner.png",
    tags: ["indicator", "pivot", "cpr", "camarilla", "levels", "gold", "xauusd", "dashboard", "mt5"],
    description: `Pivot Levels Map draws the daily, weekly and (optionally) monthly pivot levels, the daily CPR and the Camarilla levels on your MetaTrader 5 chart, and puts the context on one branded AT24 dashboard.

What you get
- Daily and weekly pivots (P, R1, R2, S1, S2); monthly pivots, R3/S3 and Camarilla H3/H4/L3/L4 can be switched on.
- Daily CPR (top and bottom) and how wide it is compared with the last 20 days: NARROW, WIDE or normal - versus the average only, never a forecast.
- Where price is now: above, inside or below the CPR, the nearest level above and below with the distance, and a table of every level with the nearest one highlighted.
- Labels with prices on the chart, colours and positions adjustable, dashboard off inside the Strategy Tester by default.

What was verified: compiles with 0 errors and 0 warnings in the real MetaEditor and runs on a real MT5 XAUUSD M15 chart (see the screenshot, IC Markets demo data, 2 Nov 2026). A descriptive study on XAUUSD M15 candles from Nov 2024 to Oct 2026 found that after the first daily touch of a pivot or CPR level, price bounced away 46.5-47.1% of the time, against 49.1-49.9% at randomly shifted placebo levels - so we found no extra reaction at the levels on that data. Use it as a map of key prices, not as a signal. Narrow-CPR days were somewhat smaller on average (median range 0.88x vs 1.02x for wide-CPR days), which is descriptive only.
Not verified: other symbols and brokers, live-money use. Levels follow your broker's day, week and month. MetaTrader 5 only; MT4 and TradingView versions are not included.${FOOTER}`,
  },
  {
    slug: "at24-hourly-range-heatmap",
    title: "AT24 Hourly Range Heatmap",
    tradingSystemId: "AT24-HOURLY-RANGE-HEATMAP",
    version: "1.00",
    zip: "AT24_HourlyRangeHeatmap_MT5_v1.00.zip",
    banner: "hourly-range-heatmap-banner.png",
    tags: ["indicator", "hourly", "volatility", "range", "heatmap", "session", "gold", "xauusd", "dashboard", "mt5"],
    description: `Hourly Range Heatmap shows which hours of the day move the most on the symbol you attach it to: a 24-hour heatmap of the average H1 range on your MetaTrader 5 chart, with the AT24 dashboard.

What you get
- 24 bars, one per hour, coloured from quiet to busy; the current hour is outlined.
- The 3 busiest and 3 quietest hours, how many times bigger the busiest hour is than the quietest, and this hour's range so far against the usual full hour.
- Uses the last 60 trading days of completed H1 bars (adjustable). Hours follow your broker's clock; one input shifts the labels to your own time.

What was verified: compiles with 0 errors and 0 warnings in the real MetaEditor and runs on a real MT5 XAUUSD M15 chart (see the screenshot, IC Markets demo, 2 Nov 2026). In that example the busiest hours were 15:00-17:00 broker time, the quietest 23:00, 07:00 and 01:00, and the busiest hour was about 3.1x the quietest - past averages on one feed that will differ by broker, symbol and period.
Not verified: other symbols, live-money use. A busy hour is not a good trade by itself: more range also means more risk and often wider spreads, so this is not a "best time to trade" tool. MetaTrader 5 only; MT4 and TradingView versions are not included.${FOOTER}`,
  },
  {
    slug: "at24-spread-by-hour",
    title: "AT24 Spread by Hour",
    tradingSystemId: "AT24-SPREAD-BY-HOUR",
    version: "1.00",
    zip: "AT24_SpreadByHour_MT5_v1.00.zip",
    banner: "spread-by-hour-banner.png",
    tags: ["indicator", "spread", "cost", "hourly", "scalping", "gold", "xauusd", "dashboard", "mt5"],
    description: `Spread by Hour shows when the spread on your broker is usually widest and tightest: a 24-hour heatmap of the average spread, read from your broker's tick history, with the AT24 dashboard on your MetaTrader 5 chart.

What you get
- 24 bars, one per hour, coloured from tight to wide; the current hour is outlined.
- The 3 widest and 3 tightest hours, widest versus tightest, and the spread right now against the usual spread for this hour.
- Uses the last 10 trading days of ticks (adjustable). Hours follow your broker's clock; one input shifts the labels to your own time.
- The first load reads ticks from the broker and can take up to about a minute. If your broker has no tick history for the symbol the dashboard says so instead of guessing.

What was verified: compiles with 0 errors and 0 warnings in the real MetaEditor and runs on a real MT5 XAUUSD M15 chart (see the screenshot, IC Markets demo, 2 Nov 2026). Our first version used the spread stored in the H1 bar history and showed almost the same value for every hour while the live spread was about three times higher, so this version measures ticks. In the example, spread was widest at 23:00 broker time (about 14 points) and tightest at 18:00 (about 7 points) - one broker, 10 days.
Not verified: other symbols, brokers and account types, live-money use. It measures a cost, not an opportunity. MetaTrader 5 only; MT4 and TradingView versions are not included.${FOOTER}`,
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
      where: { tradingSystemId_versionId_platform_artifactHash: { tradingSystemId: p.tradingSystemId, versionId, platform: "MT5", artifactHash } },
      create: { tradingSystemId: p.tradingSystemId, versionId, platform: "MT5", artifactVersion: `v${p.version}`, artifactHash, releaseStatus: "PUBLISHED" },
      update: { releaseStatus: "PUBLISHED" },
    });
    await writeFile(path.join(RELEASES_DIR, `${release.id}.zip`), bytes);
    await writeFile(path.join(RELEASES_DIR, `${release.id}.filename.txt`), p.zip, "utf-8");

    const listing = await prisma.marketplaceListing.upsert({
      where: { slug: p.slug },
      create: {
        sellerId: seller.id, slug: p.slug, title: p.title, description: p.description,
        media: [], pricing: { model: "one_time", amount: PRICE_USD, currency: "USD" },
        category: "Utility", platformTag: "MT5", assetTag: "Gold", tags: p.tags,
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

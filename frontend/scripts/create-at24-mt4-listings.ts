// scripts/create-at24-mt4-listings.ts
// AT24 education tools for MetaTrader 4 (licensed non-trading utility EAs), 11 USD each. Usage:
//   npx tsx scripts/create-at24-mt4-listings.ts            -> creates/updates the listings as DRAFT (not visible)
//   npx tsx scripts/create-at24-mt4-listings.ts --publish  -> also sets publicationState PUBLISHED
//
// MT4 does not allow WebRequest inside indicators, so each product is an Expert Advisor that only draws.
// It carries the standard AT24 licence gate: tradingSystemId doubles as the gate's product id
// (AT24-PIVOT-LEVELS-MAP-MT4 / AT24-HOURLY-RANGE-HEATMAP-MT4), so an MT5 key never opens an MT4 build.
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

const FOOTER = `\n\nEducation tool, not a signal: it draws levels and shows context, it never places orders and gives no buy or sell advice. It uses no DLL. Personal use on your own charts. Past averages and past price behaviour do not predict future price. Trading leveraged products is risky.\n\nLICENCE KEY: the download is protected by your AT24 licence key. One key works on ONE trading account at a time and only for this product; you can move it to another account yourself (2 changes per 30 days) from Dashboard > Purchases. After buying, paste the key from your purchase page into the EA input "InpLicenseKey" and allow https://www.algotraders24.ai under Tools > Options > Expert Advisors > Allow WebRequest. The Strategy Tester needs no key.`;

type Product = { slug: string; title: string; tradingSystemId: string; version: string; zip: string; icon: string; banner: string; tags: string[]; description: string };

const PRODUCTS: Product[] = [
  {
    slug: "at24-pivot-levels-map-mt4",
    title: "AT24 Pivot Levels Map (MT4)",
    tradingSystemId: "AT24-PIVOT-LEVELS-MAP-MT4",
    version: "1.02",
    zip: "AT24_PivotLevelsMap_MT4_v1.02.zip",
    icon: "pivot_levels_map-icon.png",
    banner: "pivot-levels-map-mt4-banner.png",
    tags: ["indicator", "pivot", "cpr", "camarilla", "levels", "gold", "xauusd", "dashboard", "mt4"],
    description: `Pivot Levels Map for MetaTrader 4 draws the daily, weekly and (optionally) monthly pivot levels, the daily CPR and the Camarilla levels on your chart and puts the context on one branded AT24 dashboard. It is delivered as a non-trading utility Expert Advisor because MT4 does not allow licence checks inside indicators.

What you get
- Daily and weekly pivots (P, R1, R2, S1, S2); monthly pivots, R3/S3 and Camarilla H3/H4/L3/L4 can be switched on.
- Daily CPR (top and bottom) and how wide it is compared with the last 20 days: NARROW, WIDE or normal - versus the average only, never a forecast.
- Where price is now: above, inside or below the CPR, the nearest level above and below with the distance, and a table of every level with the nearest one highlighted. Labels with prices on the chart.

What was verified: compiles with 0 errors and 0 warnings in MetaEditor 4 and runs on a real MT4 XAUUSD M15 chart (Exness demo history, see the screenshot). On our MT5 version, a descriptive study on XAUUSD M15 candles from Nov 2024 to Oct 2026 found that after the first daily touch of a pivot or CPR level, price bounced away 46.5-47.1% of the time, against 49.1-49.9% at randomly shifted placebo levels - so we found no extra reaction at the levels on that data. Use it as a map of key prices, not as a signal.
Not verified: live-money use, other symbols and brokers, the licence check with a real purchase on MT4. Levels follow your broker's day, week and month. MetaTrader 4 only.${FOOTER}`,
  },
  {
    slug: "at24-hourly-range-heatmap-mt4",
    title: "AT24 Hourly Range Heatmap (MT4)",
    tradingSystemId: "AT24-HOURLY-RANGE-HEATMAP-MT4",
    version: "1.01",
    zip: "AT24_HourlyRangeHeatmap_MT4_v1.01.zip",
    icon: "hourly_range_heatmap-icon.png",
    banner: "hourly-range-heatmap-mt4-banner.png",
    tags: ["indicator", "hourly", "volatility", "range", "heatmap", "session", "gold", "xauusd", "dashboard", "mt4"],
    description: `Hourly Range Heatmap for MetaTrader 4 shows which hours of the day move the most on the symbol you attach it to: a 24-hour heatmap of the average H1 range with the AT24 dashboard. It is delivered as a non-trading utility Expert Advisor because MT4 does not allow licence checks inside indicators.

What you get
- 24 bars, one per hour, coloured from quiet to busy; the current hour is outlined.
- The 3 busiest and 3 quietest hours, how many times bigger the busiest hour is than the quietest, and this hour's range so far against the usual full hour.
- Uses the last 60 trading days of H1 bars (adjustable). Hours follow your broker's clock; one input shifts the labels to your own time.

What was verified: compiles with 0 errors and 0 warnings in MetaEditor 4 and runs on a real MT4 XAUUSD M15 chart (Exness demo history, see the screenshot); the busiest-versus-quietest ratio matched our MT5 and TradingView versions on XAUUSD (about 3 times). Past averages on one feed will differ by broker, symbol and period; hours with too few bars show as empty.
Not verified: other symbols and brokers, live-money use, the licence check with a real purchase on MT4. A busy hour is not a good trade by itself: more range also means more risk, so this is not a "best time to trade" tool. MetaTrader 4 only.${FOOTER}`,
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
      where: { tradingSystemId_versionId_platform_artifactHash: { tradingSystemId: p.tradingSystemId, versionId, platform: "MT4", artifactHash } },
      create: { tradingSystemId: p.tradingSystemId, versionId, platform: "MT4", artifactVersion: `v${p.version}`, artifactHash, releaseStatus: "PUBLISHED" },
      update: { releaseStatus: "PUBLISHED" },
    });
    await writeFile(path.join(RELEASES_DIR, `${release.id}.zip`), bytes);
    await writeFile(path.join(RELEASES_DIR, `${release.id}.filename.txt`), p.zip, "utf-8");

    const listing = await prisma.marketplaceListing.upsert({
      where: { slug: p.slug },
      create: {
        sellerId: seller.id, slug: p.slug, title: p.title, description: p.description,
        media: [], pricing: { model: "one_time", amount: PRICE_USD, currency: "USD" },
        category: "Utility", platformTag: "MT4", assetTag: "Gold", tags: p.tags,
        tradingSystemId: p.tradingSystemId, versionId,
        publicationState: "DRAFT",
      },
      update: { title: p.title, description: p.description, tags: p.tags, versionId, tradingSystemId: p.tradingSystemId, pricing: { model: "one_time", amount: PRICE_USD, currency: "USD" } },
    });

    const mediaDir = path.join(__dirname, "..", "public", "marketplace", listing.id);
    await mkdir(mediaDir, { recursive: true });
    await copyFile(path.join(ROOT, "branding", p.icon), path.join(mediaDir, "icon2.png"));
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

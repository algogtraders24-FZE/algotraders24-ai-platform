// scripts/create-at24-volatility-forecast-listings.ts
// AT24 Volatility Forecast - MT5 (licensed non-trading utility EA that embeds the indicator), 11 USD.
//   npx tsx scripts/create-at24-volatility-forecast-listings.ts            -> creates/updates the listings as DRAFT (not visible)
//   npx tsx scripts/create-at24-volatility-forecast-listings.ts --publish  -> also sets publicationState PUBLISHED
// MT5 tradingSystemId doubles as the licence gate's product id (AT24-VOLATILITY-FORECAST).
// Claims rule: SIZE of moves only: no direction, no signals, no "volatility breakout edge"; the correlation is moderate, real moves have fatter tails than sigma bands; not a guarantee a stop survives.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const PRICE_USD = 22; // set by the owner
const ROOT = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m18-at24-indicators");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const FOOT = `\n\nDescriptive history on your own broker data. Context tool, not a signal or a forecast; it prints no buy or sell arrows and never places orders; it shows the size of moves, not their direction, real moves have fatter tails than sigma bands suggest, and the numbers are for one symbol and period; H1 or lower charts only. Not financial advice. Trading leveraged products is risky.`;

const LICENCE = `\n\nLICENCE KEY: the download is protected by your AT24 licence key. One key works on ONE trading account at a time and only for this product; you can move it to another account yourself (2 changes per 30 days) from Dashboard > Purchases. After buying, paste the key from your purchase page into the EA input "InpLicenseKey" and allow https://www.algotraders24.ai under Tools > Options > Expert Advisors > Allow WebRequest. The Strategy Tester needs no key.`;

const RESULT = `Real result on one broker feed (XAUUSD M15, 243 non-overlapping 8-hour windows): the time-of-day-aware forecast tracked the volatility that followed with a correlation of about 0.40, with 74% of windows within +-30% - against about 0.10 and 60% for a plain average and about 0.11 and 36% for ATR(14), which ran about 34% low. A correlation of 0.4 is moderate, not strong; real moves have fatter tails than sigma bands suggest. It shows the SIZE of moves, never their direction, and is not an edge.`;

type Product = { slug: string; title: string; tradingSystemId: string; version: string; platform: string; zip: string; banner: string; tags: string[]; description: string };

const PRODUCTS: Product[] = [
  {
    slug: "at24-volatility-forecast",
    title: "AT24 Volatility Forecast (MT5)",
    tradingSystemId: "AT24-VOLATILITY-FORECAST",
    version: "1.01",
    platform: "MT5",
    zip: "AT24_VolatilityForecast_MT5_v1.01.zip",
    banner: "volatility-forecast-banner.png",
    tags: ["indicator", "volatility", "forecast", "sigma", "range", "time-of-day", "statistics", "dashboard", "gold", "xauusd", "mt5", "demo-tested"],
    description: `Traders set stops and targets without knowing whether the market is quiet or wild for this time of day. AT24 Volatility Forecast estimates volatility from open/high/low/close, removes gold's time-of-day pattern, and shows the expected 1-sigma and 2-sigma move for the next hours - plus a calibration table that shows how well it really tracked what followed on your own symbol.

What you get
- The expected 1-sigma and 2-sigma move for the next 8 hours as bands on your chart, with the dollar and percentage size.
- A volatility regime with its percentile and how many times its normal level it is now.
- A calibration table on your own data: the forecast against a plain average and against ATR(14) - correlation, share of windows within +-30%, and how far ATR runs low.
- The time-of-day profile uses only past bars, so nothing looks ahead. H1 or lower charts only.

It is delivered as a non-trading utility Expert Advisor with the indicator built into the file (MT5 does not allow licence checks inside indicators): attach it to a chart and the bands and dashboard appear.

What was verified: compiles with 0 errors and 0 warnings in the real MetaEditor and runs on a real MT5 XAUUSD M15 chart (see the screenshot). All eight forecasts, the calibration and the percentile match an independent Python calculation (identical).
${RESULT}
Not verified: live-money use, alerts beyond a screenshot, the licence check with a real purchase. MetaTrader 5 only.${FOOT}${LICENCE}`,
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
    await copyFile(path.join(ROOT, "branding", "volatility_forecast-icon.png"), path.join(mediaDir, "icon2.png"));
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

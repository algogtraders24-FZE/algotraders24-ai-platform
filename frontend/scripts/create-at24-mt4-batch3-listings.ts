// scripts/create-at24-mt4-batch3-listings.ts
// AT24 education tools for MetaTrader 4 (licensed non-trading utility EAs), 11 USD each. Usage:
//   npx tsx scripts/create-at24-mt4-batch3-listings.ts            -> creates/updates the listings as DRAFT (not visible)
//   npx tsx scripts/create-at24-mt4-batch3-listings.ts --publish  -> also sets publicationState PUBLISHED
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
const PRICE_USD = 22; // set by the owner
const ROOT = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m18-at24-indicators");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const FOOTER = `\n\nEducation tool, not a signal: it draws levels and shows context, it never places orders and gives no buy or sell advice. It uses no DLL. Personal use on your own charts. Past averages and past price behaviour do not predict future price. Trading leveraged products is risky.\n\nLICENCE KEY: the download is protected by your AT24 licence key. One key works on ONE trading account at a time and only for this product; you can move it to another account yourself (2 changes per 30 days) from Dashboard > Purchases. After buying, paste the key from your purchase page into the EA input "InpLicenseKey" and allow https://www.algotraders24.ai under Tools > Options > Expert Advisors > Allow WebRequest. The Strategy Tester needs no key.`;

type Product = { slug: string; title: string; tradingSystemId: string; version: string; zip: string; icon: string; banner: string; tags: string[]; description: string };

const PRODUCTS: Product[] = [
  {
    "slug": "at24-weekday-bias-map-mt4",
    "title": "AT24 Weekday Bias Map (MT4)",
    "tradingSystemId": "AT24-WEEKDAY-BIAS-MAP-MT4",
    "version": "1.00",
    "zip": "AT24_WeekdayBiasMap_MT4_v1.00.zip",
    "icon": "weekday_bias_map-icon.png",
    "banner": "weekday-bias-map-mt4-banner.png",
    "tags": [
      "indicator",
      "weekday",
      "seasonality",
      "day-of-week",
      "statistics",
      "dashboard",
      "gold",
      "mt4",
      "demo-tested"
    ],
    "description": "'Never buy on Mondays' and 'Fridays are bullish' are repeated everywhere and rarely checked. AT24 Weekday Bias Map for MetaTrader 4 measures on your own symbol whether the daily return really depends on the weekday - with t-statistics, a chance check across the five weekdays, and a split-half check of whether the pattern held.\n\nWhat you get\n- The mean daily return per weekday (Monday to Friday) in basis points as a small bar chart, with today highlighted and significant days marked.\n- A dashboard: the verdict (no weekday stands out / a weekday stands out in the past data), the t-statistic per weekday, how many of the five weekdays reach |t| of 1.96 (chance alone gives about 0.25), and in how many both halves of the history agree in sign.\n- It reads the daily candles of the symbol on demand; works on any chart timeframe. Dashboard is off in the Strategy Tester by default.\n\nWhat was verified: compiles with 0 errors and 0 warnings in MetaEditor 4 and runs on an MT4 demo terminal on XAUUSD (3,000 daily candles: no weekday reached |t| of 1.96 - Monday +0.41, Tuesday +0.53, Wednesday +1.65, Thursday +0.66, Friday +1.29 - and the pattern of the first half did not persist in the second: correlation -0.25 - see the screenshot). Gold rose over the period, so every weekday is positive. These numbers are historical and descriptive and show no edge: there is no 'best day to buy' in this data.\nNot verified: live-money use, other symbols and brokers, the licence check with a real purchase on MT4. It is delivered as a non-trading utility Expert Advisor (MT4 does not allow licence checks inside indicators). MetaTrader 4 only.\n\nEducation tool, not a signal: it draws levels and shows context, it never places orders and gives no buy or sell advice. It uses no DLL. Personal use on your own charts. Past averages and past price behaviour do not predict the future."
  },
  {
    "slug": "at24-order-block-lab-mt4",
    "title": "AT24 Order Block Lab (MT4)",
    "tradingSystemId": "AT24-ORDER-BLOCK-LAB-MT4",
    "version": "1.00",
    "zip": "AT24_OrderBlockLab_MT4_v1.00.zip",
    "icon": "order_block_lab-icon.png",
    "banner": "order-block-lab-mt4-banner.png",
    "tags": [
      "indicator",
      "order-block",
      "smc",
      "levels",
      "statistics",
      "dashboard",
      "gold",
      "mt4",
      "demo-tested"
    ],
    "description": "'Price returns to the order block and reverses' is repeated everywhere and rarely checked. AT24 Order Block Lab for MetaTrader 4 marks order blocks on closed bars - the last opposite-colour candle before a strong move, the definition is stated openly in the dashboard text - and measures on your own symbol whether price really came back to them and reacted, next to a control zone mirrored through the confirming price.\n\nWhat you get\n- The untouched blocks drawn as zones on your chart (newest first), with the nearest block above and below price.\n- A dashboard: blocks found, how often price came back within 100 bars (block and control zone), and how often it reacted away before breaking the level, each with a 95% interval and sample size.\n- A block is confirmed only after the move closes, so nothing repaints. Works on any timeframe. Dashboard is off in the Strategy Tester by default.\n\nWhat was verified: compiles with 0 errors and 0 warnings in MetaEditor 4 and runs on an MT4 demo terminal on XAUUSD H1 (last 8,000 bars, 487 blocks: price came back within 100 bars 82% of the time against 78% for the control zone, and reacted away 52% against 49% - see the screenshot). These numbers are historical and descriptive and show no edge: the block behaves like a control zone, so there is no 'order block effect' in this data.\nNot verified: live-money use, other symbols and brokers, the licence check with a real purchase on MT4. It is delivered as a non-trading utility Expert Advisor (MT4 does not allow licence checks inside indicators). MetaTrader 4 only.\n\nEducation tool, not a signal: it draws levels and shows context, it never places orders and gives no buy or sell advice. It uses no DLL. Personal use on your own charts. Past averages and past price behaviour do not predict the future."
  }
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

// scripts/create-at24-regime-pulse-listings.ts
// AT24 Regime Pulse - MT5 (licensed non-trading utility EA that embeds the indicator) and TradingView (Pine source), 11 USD each.
//   npx tsx scripts/create-at24-regime-pulse-listings.ts            -> creates/updates the listings as DRAFT (not visible)
//   npx tsx scripts/create-at24-regime-pulse-listings.ts --publish  -> also sets publicationState PUBLISHED
// MT5 tradingSystemId doubles as the licence gate's product id (AT24-REGIME-PULSE). MT4 is not included: the MT4 indicator
// cannot be loaded from an EA, so an MT4 edition needs a different (dashboard-only) design.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const PRICE_USD = 11; // set by the owner
const ROOT = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m18-at24-indicators");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const COMMON = `AT24 Regime Pulse tells you what kind of market you are in right now, on one dashboard and one coloured histogram.

What you get
- Regime label: TREND, STRONG TREND, RANGE, CHOP (volatile range), QUIET or MIXED.
- Trend quality: the Kaufman Efficiency Ratio (net move divided by the path travelled, 0 to 1).
- Volatility rank: where today's ATR sits against the last 500 bars (0 to 100).
- Spread / ATR cost ratio with a HIGH COST warning, and the trading session (Asia, London, London-New York overlap, New York, Rollover).
- Optional alert when the regime changes, at bar close only (no repaint of closed bars).`;

const HONEST = `Our own check found that regimes do NOT persist: the Efficiency Ratio of the next 20 bars was about 0.21-0.24 in every regime (XAUUSD M5, 2025-26, about 54,000 bars). Regime Pulse describes the CURRENT state; it does not forecast. A real-data fact from the same sample: spread cost was about 6% of ATR in strong-trend bars and about 13% in QUIET bars, so quiet periods are the most expensive to trade.`;

const FOOT = `\n\nContext tool. Not a signal. Past conditions do not predict future results. Not financial advice. It never places orders and gives no buy or sell advice. Trading leveraged products is risky.`;

const LICENCE = `\n\nLICENCE KEY: the download is protected by your AT24 licence key. One key works on ONE trading account at a time and only for this product; you can move it to another account yourself (2 changes per 30 days) from Dashboard > Purchases. After buying, paste the key from your purchase page into the EA input "InpLicenseKey" and allow https://www.algotraders24.ai under Tools > Options > Expert Advisors > Allow WebRequest. The Strategy Tester needs no key.`;

type Product = { slug: string; title: string; tradingSystemId: string; version: string; platform: string; zip: string; banner: string; tags: string[]; description: string };

const PRODUCTS: Product[] = [
  {
    slug: "at24-regime-pulse",
    title: "AT24 Regime Pulse (MT5)",
    tradingSystemId: "AT24-REGIME-PULSE",
    version: "1.01",
    platform: "MT5",
    zip: "AT24_RegimePulse_MT5_v1.01.zip",
    banner: "regime-pulse-banner.png",
    tags: ["indicator", "regime", "trend-quality", "volatility", "efficiency-ratio", "session", "dashboard", "gold", "mt5"],
    description: `${COMMON}

It is delivered as a non-trading utility Expert Advisor with the indicator built into the file (MT5 does not allow licence checks inside indicators): attach it to a chart and the indicator window opens below the chart.

What was verified: compiles with 0 errors and 0 warnings in the real MetaEditor and runs on a real MT5 XAUUSD M15 chart (see the screenshot). The calculation matches an independent Python recomputation on 4,000 real XAUUSD M5 bars (differences only from rounding).
${HONEST}
Not verified: live-money use, alerts on a live feed, other symbols and brokers, the licence check with a real purchase. MetaTrader 5 only; a MetaTrader 4 edition is not included yet.${FOOT}${LICENCE}`,
  },
  {
    slug: "at24-regime-pulse-tradingview",
    title: "AT24 Regime Pulse (TradingView)",
    tradingSystemId: "AT24-REGIME-PULSE-TV",
    version: "1.00",
    platform: "TradingView",
    zip: "AT24_RegimePulse_TradingView_v1.00.zip",
    banner: "regime-pulse-tv-banner.png",
    tags: ["indicator", "regime", "trend-quality", "volatility", "efficiency-ratio", "session", "dashboard", "gold", "tradingview", "pine"],
    description: `${COMMON}

Pine Script edition: a coloured histogram with the volatility rank line in its own pane plus a dashboard table. TradingView has no tick spread, so the Spread / ATR row uses the typical spread you enter in the inputs.

What was verified: the script compiles and renders in TradingView's Pine Editor (XAUUSD 1h, see the screenshot).
${HONEST}
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
    await copyFile(path.join(ROOT, "branding", "regime_pulse-icon.png"), path.join(mediaDir, "icon2.png"));
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

// scripts/create-at24-ms-fib-tv-listings.ts
// AT24 Market Structure and Auto Fib Zones - TradingView (Pine source), 11 USD each.
//   npx tsx scripts/create-at24-ms-fib-tv-listings.ts            -> creates/updates the listings as DRAFT (not visible)
//   npx tsx scripts/create-at24-ms-fib-tv-listings.ts --publish  -> also sets publicationState PUBLISHED
// Claims rule: descriptive history only; no edge, no "CHoCH reversal entry", no "price reacts at 61.8", no win rate.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const PRICE_USD = 11; // set by the owner
const ROOT = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m18-at24-indicators");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const FOOT = `\n\nDescriptive history on your own broker data. Context tool, not a signal or a forecast; it prints no buy or sell arrows and never places orders; swing size is an input and other sizes give other numbers. Not financial advice. Trading leveraged products is risky.`;

const LICENCE = `\n\nLICENCE KEY: the download is protected by your AT24 licence key. One key works on ONE trading account at a time and only for this product; you can move it to another account yourself (2 changes per 30 days) from Dashboard > Purchases. After buying, paste the key from your purchase page into the EA input "InpLicenseKey" and allow https://www.algotraders24.ai under Tools > Options > Expert Advisors > Allow WebRequest. The Strategy Tester needs no key.`;

type Product = { slug: string; title: string; tradingSystemId: string; version: string; platform: string; zip: string; banner: string; icon: string; tags: string[]; description: string };

const TV_LICENCE_NOTE = `Delivered as a zip with the Pine source and a one-minute install guide. Plain Pine source with no web access: TradingView cannot check a licence key inside a script, so the licence is the purchase itself - the file is delivered to your AT24 account for use on your own TradingView account, please do not share or publish it.`;

const PRODUCTS: Product[] = [
  {
    slug: "at24-market-structure-tradingview",
    title: "AT24 Market Structure (TradingView)",
    tradingSystemId: "AT24-MARKET-STRUCTURE-TV",
    version: "1.00",
    platform: "TradingView",
    zip: "AT24_MarketStructure_TradingView_v1.00.zip",
    banner: "market-structure-tv-banner.png",
    icon: "market_structure-icon.png",
    tags: ["indicator", "market-structure", "bos", "choch", "swing", "statistics", "dashboard", "gold", "tradingview", "pine", "demo-tested"],
    description: `AT24 Market Structure for TradingView draws BOS (break of structure) and CHoCH (change of character) lines on your chart from one fixed rule, and measures what price really did after them on the chart you are looking at (Pine Script).

What you get
- BOS (with the trend) and CHoCH (against it) lines with labels, plus the open swing high and low as dashed lines.
- One fixed rule: swings are confirmed after N bars (an input), a break needs a bar CLOSE beyond the latest unbroken swing (wicks do not count). Closed bars only.
- A dashboard table: structure state, the last break, counts, and how often price was still going in the break direction 20 bars later after a BOS, after a CHoCH and after any bar. Alert conditions for a BOS and a CHoCH.
- TradingView uses all the bars loaded on your chart, so counts differ from the MetaTrader 5 edition by timeframe and history.

What was verified: the script compiles and renders in TradingView's Pine Editor (OANDA XAUUSD 1h: 261 BOS and 252 CHoCH; 20 bars later price was still going in the break direction after 55% of BOS and 44% of CHoCH, 54% after any bar - see the screenshot). The MetaTrader 5 test on M15 showed the reverse (about 43% / 55%), so there is no consistent difference and no edge: structure labels describe the chart, they do not predict it.
Not verified: live-money use, other symbols and exchanges. ${TV_LICENCE_NOTE}${FOOT}`,
  },
  {
    slug: "at24-auto-fib-zones-tradingview",
    title: "AT24 Auto Fib Zones (TradingView)",
    tradingSystemId: "AT24-AUTO-FIB-ZONES-TV",
    version: "1.00",
    platform: "TradingView",
    zip: "AT24_AutoFibZones_TradingView_v1.00.zip",
    banner: "auto-fib-zones-tv-banner.png",
    icon: "auto_fib_zones-icon.png",
    tags: ["indicator", "fibonacci", "retracement", "swing", "levels", "statistics", "dashboard", "gold", "tradingview", "pine", "demo-tested"],
    description: `AT24 Auto Fib Zones for TradingView finds the swing by a fixed, confirmed rule, draws the Fibonacci levels on the last leg, and shows how deep pullbacks really went on the chart you are looking at (Pine Script).

What you get
- Levels 0 / 23.6 / 38.2 / 50 / 61.8 / 78.6 / 100% on the last confirmed swing leg, the 38.2-61.8 zone shaded, and the leg drawn. Swings are the strict extreme of N bars on each side (an input), confirmed N bars later.
- A dashboard table: the last leg, the current pullback depth, legs measured, the median pullback, how often pullbacks reached 38.2 / 50 / 61.8%, how often they went past 100% and how often the leg's extreme was beaten.
- TradingView uses all the bars loaded on your chart, so counts differ from the MetaTrader 5 edition by timeframe and history.

What was verified: the script compiles and renders in TradingView's Pine Editor (OANDA XAUUSD 1h, 1,082 legs: median pullback 95% of the leg; reached 38.2 / 50 / 61.8% in 92 / 84 / 76% of legs; 48% went past 100%; the leg's extreme was beaten 48% of the time - see the screenshot). These numbers are historical and descriptive, depend on the swing size, and show no edge: the levels are a reference grid, not magic numbers.
Not verified: live-money use, other symbols and exchanges. ${TV_LICENCE_NOTE}${FOOT}`,
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

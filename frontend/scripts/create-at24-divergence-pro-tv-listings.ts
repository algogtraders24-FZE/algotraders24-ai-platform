// scripts/create-at24-divergence-pro-tv-listings.ts
// AT24 Divergence Pro - TradingView (Pine source), 11 USD each.
//   npx tsx scripts/create-at24-divergence-pro-tv-listings.ts            -> creates/updates the listings as DRAFT (not visible)
//   npx tsx scripts/create-at24-divergence-pro-tv-listings.ts --publish  -> also sets publicationState PUBLISHED
// Claims rule: descriptive history only; no edge, no "CHoCH reversal entry", no "price reacts at 61.8", no win rate.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const PRICE_USD = 33; // set by the owner
const ROOT = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m18-at24-indicators");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const FOOT = `\n\nDescriptive history on your own broker data. Context tool, not a signal or a forecast; it prints no buy or sell arrows and never places orders; swing size is an input and other sizes give other numbers. Not financial advice. Trading leveraged products is risky.`;

const LICENCE = `\n\nLICENCE KEY: the download is protected by your AT24 licence key. One key works on ONE trading account at a time and only for this product; you can move it to another account yourself (2 changes per 30 days) from Dashboard > Purchases. After buying, paste the key from your purchase page into the EA input "InpLicenseKey" and allow https://www.algotraders24.ai under Tools > Options > Expert Advisors > Allow WebRequest. The Strategy Tester needs no key.`;

type Product = { slug: string; title: string; tradingSystemId: string; version: string; platform: string; zip: string; banner: string; icon: string; tags: string[]; description: string };

const TV_LICENCE_NOTE = `Delivered as a zip with the Pine source and a one-minute install guide. Plain Pine source with no web access: TradingView cannot check a licence key inside a script, so the licence is the purchase itself - the file is delivered to your AT24 account for use on your own TradingView account, please do not share or publish it.`;

const PRODUCTS: Product[] = [
  {
    slug: "at24-divergence-pro-tradingview",
    title: "AT24 Divergence Pro for TradingView",
    tradingSystemId: "AT24-DIVERGENCE-PRO-TV",
    version: "1.00",
    platform: "TradingView",
    zip: "AT24_DivergencePro_TradingView_v1.00.zip",
    banner: "divergence-pro-tv-banner.png",
    icon: "divergence_pro-icon.png",
    tags: ["indicator", "divergence", "rsi", "scorecard", "statistics", "dashboard", "gold", "tradingview", "pine", "demo-tested"],
    description: `Divergence indicators are popular and often repaint: a swing appears, then moves or vanishes. AT24 Divergence Pro for TradingView uses a swing only after the bars to its right have closed, and then grades every past divergence on this chart (Pine Script).

What you get
- RSI divergence lines and labels on closed bars, so nothing repaints (the signal comes a few bars after the swing).
- A plan for a live divergence: entry, stop and target.
- Scorecards for bullish, bearish and all divergences: trades, hit rate, average R after a cost you set, and total R.
- A sign-flip luck test: the verdict is positive or negative only beyond luck, otherwise it reads no edge shown (too few under 30 trades).
- Recomputed on the chart from the loaded bars; nothing is stored or sent. A TradingView feed holds fewer bars than a broker terminal, so counts are smaller than in the MetaTrader editions.

What was verified: the script compiles and renders in TradingView's Pine Editor (OANDA XAUUSD 15m, all groups scored with no edge shown - see the screenshot). The scoring chain matches an independent Python calculation in the MetaTrader 5 edition. Not verified: the live-divergence block and alerts. Past results on a chart do not predict future results. Research tool, not a signal, not financial advice.
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

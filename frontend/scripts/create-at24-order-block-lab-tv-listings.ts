// scripts/create-at24-order-block-lab-tv-listings.ts
// AT24 Order Block Lab - TradingView (Pine source), 11 USD each.
//   npx tsx scripts/create-at24-order-block-lab-tv-listings.ts            -> creates/updates the listings as DRAFT (not visible)
//   npx tsx scripts/create-at24-order-block-lab-tv-listings.ts --publish  -> also sets publicationState PUBLISHED
// Claims rule: descriptive history only; no edge, no "CHoCH reversal entry", no "price reacts at 61.8", no win rate.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const PRICE_USD = 22; // set by the owner
const ROOT = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m18-at24-indicators");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const FOOT = `\n\nDescriptive history on your own broker data. Context tool, not a signal or a forecast; it prints no buy or sell arrows and never places orders; swing size is an input and other sizes give other numbers. Not financial advice. Trading leveraged products is risky.`;

const LICENCE = `\n\nLICENCE KEY: the download is protected by your AT24 licence key. One key works on ONE trading account at a time and only for this product; you can move it to another account yourself (2 changes per 30 days) from Dashboard > Purchases. After buying, paste the key from your purchase page into the EA input "InpLicenseKey" and allow https://www.algotraders24.ai under Tools > Options > Expert Advisors > Allow WebRequest. The Strategy Tester needs no key.`;

type Product = { slug: string; title: string; tradingSystemId: string; version: string; platform: string; zip: string; banner: string; icon: string; tags: string[]; description: string };

const TV_LICENCE_NOTE = `Delivered as a zip with the Pine source and a one-minute install guide. Plain Pine source with no web access: TradingView cannot check a licence key inside a script, so the licence is the purchase itself - the file is delivered to your AT24 account for use on your own TradingView account, please do not share or publish it.`;

const PRODUCTS: Product[] = [
  {
    slug: "at24-order-block-lab-tradingview",
    title: "AT24 Order Block Lab (TradingView)",
    tradingSystemId: "AT24-ORDER-BLOCK-LAB-TV",
    version: "1.00",
    platform: "TradingView",
    zip: "AT24_OrderBlockLab_TradingView_v1.00.zip",
    banner: "order-block-lab-tv-banner.png",
    icon: "order_block_lab-icon.png",
    tags: ["indicator", "order-block", "smc", "levels", "statistics", "dashboard", "gold", "tradingview", "pine", "demo-tested"],
    description: `'Price returns to the order block and reverses' is repeated everywhere and rarely checked. AT24 Order Block Lab for TradingView marks order blocks on closed bars and measures on the chart you are looking at whether price really came back to them and reacted - next to a control zone mirrored through the confirming price (Pine Script).

What you get
- The newest untouched blocks drawn as zones on your chart, with the nearest block above and below price. A block is confirmed only after the strong move closes, so nothing repaints.
- A dashboard table: blocks found, how often price came back within the window (block and control zone), and how often it reacted away before breaking the level, each with a 95% interval and sample size.
- The definition of a block is stated openly in the dashboard text. Counts use the history loaded on your chart, so they differ from the MetaTrader editions.

What was verified: the script compiles and renders in TradingView's Pine Editor (OANDA XAUUSD 1h, 307 measured blocks: price came back within 100 bars 81% of the time against 76% for the control zone, and reacted away 51% against 50% - see the screenshot). These numbers are historical and descriptive and show no edge: the block behaves like a control zone, so there is no 'order block effect' in this data.
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

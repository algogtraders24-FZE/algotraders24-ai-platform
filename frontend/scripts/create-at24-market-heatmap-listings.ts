// scripts/create-at24-market-heatmap-listings.ts
// AT24 Market Heatmap - MT5 (licensed non-trading utility EA that embeds the indicator), 11 USD.
//   npx tsx scripts/create-at24-market-heatmap-listings.ts            -> creates/updates the listings as DRAFT (not visible)
//   npx tsx scripts/create-at24-market-heatmap-listings.ts --publish  -> also sets publicationState PUBLISHED
// MT5 tradingSystemId doubles as the licence gate's product id (AT24-MARKET-HEATMAP).
// Claims rule: no 'signals', no profit promises; an abnormal move is information, not a trade idea; no calculation details beyond what the brief allows.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const PRICE_USD = 33; // set by the owner
const ROOT = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m18-at24-indicators");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const FOOT = `\n\nDescriptive history on your own broker data. Context tool, not a signal or a forecast; it is a descriptive overview: it places no orders and gives no signals, an unusual move is information and not a trade idea, and past moves do not predict future moves. Not financial advice. Not financial advice. Trading leveraged products is risky.`;

const LICENCE = `\n\nLICENCE KEY: the download is protected by your AT24 licence key. One key works on ONE trading account at a time and only for this product; you can move it to another account yourself (2 changes per 30 days) from Dashboard > Purchases. After buying, paste the key from your purchase page into the EA input "InpLicenseKey" and allow https://www.algotraders24.ai under Tools > Options > Expert Advisors > Allow WebRequest. The Strategy Tester needs no key.`;

const RESULT = `Eleven broker symbols on an IC Markets demo feed: the panel loaded forex, metals, indices and crypto rows with live moves and no abnormal-move flag on the day of the check. A symbol the broker does not offer is shown as not found.`;

type Product = { slug: string; title: string; tradingSystemId: string; version: string; platform: string; zip: string; banner: string; tags: string[]; description: string };

const PRODUCTS: Product[] = [
  {
    slug: "at24-market-heatmap",
    title: "AT24 Market Heatmap",
    tradingSystemId: "AT24-MARKET-HEATMAP",
    version: "1.00",
    platform: "MT5",
    zip: "AT24_MarketHeatmap_MT5_v1.00.zip",
    banner: "market-heatmap-banner.png",
    tags: ["indicator", "market-overview", "heatmap", "multi-asset", "volatility", "dashboard", "research", "mt5", "demo-tested"],
    description: `AT24 Market Heatmap shows what moved today, and what moved more than usual, across forex, metals, energy, indices, stocks and crypto in one panel.

In fast markets it is hard to see which markets are moving abnormally. Market Heatmap puts up to 25 of your own broker symbols in one table so you can compare them at a glance.

What you get
- For each symbol: the live move today, the 1, 5 and 21 day change, ATR as a percent of price and the position inside the 52 week range.
- The last closed daily move measured in ATRs, with a flag when it is unusually large and an optional alert once per symbol per daily bar.
- A simple trend and RSI reading, and sorting by list order, biggest move, today or 21 days.
- It uses prices only. It never places orders and gives no signals.

An unusual move is information, not a trade idea. Past moves do not predict future moves. Not financial advice.

It is delivered as a non-trading utility Expert Advisor with the indicator built into the file (MT5 does not allow licence checks inside indicators): attach it to any chart and the panel appears. Edit the symbol list to the exact names your broker uses.

What was verified: compiles with 0 errors and 0 warnings in the real MetaEditor and runs on a real MT5 chart with broker symbols (see the screenshot). Every field matches an independent Python calculation on two symbols. A symbol the broker does not offer is shown as not found. Not verified: the abnormal-move alert on a live connected chart.
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
    await copyFile(path.join(ROOT, "branding", "market_heatmap-icon.png"), path.join(mediaDir, "icon2.png"));
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

// scripts/create-at24-market-structure-listings.ts
// AT24 Market Structure - MT5 (licensed non-trading utility EA that embeds the indicator), 11 USD.
//   npx tsx scripts/create-at24-market-structure-listings.ts            -> creates/updates the listings as DRAFT (not visible)
//   npx tsx scripts/create-at24-market-structure-listings.ts --publish  -> also sets publicationState PUBLISHED
// MT5 tradingSystemId doubles as the licence gate's product id (AT24-MARKET-STRUCTURE).
// Claims rule: descriptive history only; no "CHoCH reversal entry", no "BOS continuation", no win rate, no edge (breaks were no better than any other bar).
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const PRICE_USD = 11; // set by the owner
const ROOT = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m18-at24-indicators");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const FOOT = `\n\nDescriptive history on your own broker data. Context tool, not a signal or a forecast; it prints no buy or sell arrows and never places orders; a break is a bar CLOSE beyond a confirmed swing and other swing sizes give other events and numbers. Not financial advice. Trading leveraged products is risky.`;

const LICENCE = `\n\nLICENCE KEY: the download is protected by your AT24 licence key. One key works on ONE trading account at a time and only for this product; you can move it to another account yourself (2 changes per 30 days) from Dashboard > Purchases. After buying, paste the key from your purchase page into the EA input "InpLicenseKey" and allow https://www.algotraders24.ai under Tools > Options > Expert Advisors > Allow WebRequest. The Strategy Tester needs no key.`;

const RESULT = `Real result on one broker feed (XAUUSD M15, last 8,000 closed bars, about 370 breaks with a 5-bar swing): 20 bars after a BOS price was still going in the break direction about 43% of the time, after a CHoCH about 55%, against about 48% after an ordinary bar. In other words, structure labels describe the chart but were no better than any other bar at predicting it. This is descriptive, depends on the swing size, and is not an edge.`;

type Product = { slug: string; title: string; tradingSystemId: string; version: string; platform: string; zip: string; banner: string; tags: string[]; description: string };

const PRODUCTS: Product[] = [
  {
    slug: "at24-market-structure",
    title: "AT24 Market Structure (MT5)",
    tradingSystemId: "AT24-MARKET-STRUCTURE",
    version: "1.01",
    platform: "MT5",
    zip: "AT24_MarketStructure_MT5_v1.01.zip",
    banner: "market-structure-banner.png",
    tags: ["indicator", "market-structure", "bos", "choch", "swing", "statistics", "dashboard", "gold", "xauusd", "mt5", "demo-tested"],
    description: `"Break of structure" and "change of character" are drawn differently by every trader. AT24 Market Structure applies one fixed rule, draws the breaks on your chart, and measures what price did after them on your own symbol.

What you get
- BOS (with the trend) and CHoCH (against it) lines on your chart, plus the open swing high and swing low.
- One fixed rule: swings are confirmed after N bars, a break needs a bar CLOSE beyond the latest unbroken swing (wicks do not count). Closed bars only, so nothing repaints. The swing size is an input.
- A dashboard with the structure state, the last break, and real history on your own data: how many BOS and CHoCH happened and how often price was still going in the break direction 20 bars later, against an ordinary bar. Optional alert on a new break (bar close, no repaint).

It is delivered as a non-trading utility Expert Advisor with the indicator built into the file (MT5 does not allow licence checks inside indicators): attach it to a chart and the lines and dashboard appear.

What was verified: compiles with 0 errors and 0 warnings in the real MetaEditor and runs on a real MT5 XAUUSD M15 chart (see the screenshot). The breaks and statistics match an independent Python calculation (all 364 events identical).
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
    await copyFile(path.join(ROOT, "branding", "market_structure-icon.png"), path.join(mediaDir, "icon2.png"));
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

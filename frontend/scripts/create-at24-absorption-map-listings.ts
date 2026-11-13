// scripts/create-at24-absorption-map-listings.ts
// AT24 Absorption Map - MT5 (licensed non-trading utility EA that embeds the indicator), 11 USD.
//   npx tsx scripts/create-at24-absorption-map-listings.ts            -> creates/updates the listings as DRAFT (not visible)
//   npx tsx scripts/create-at24-absorption-map-listings.ts --publish  -> also sets publicationState PUBLISHED
// MT5 tradingSystemId doubles as the licence gate's product id (AT24-ABSORPTION-MAP).
// Claims rule: no 'smart money', no 'order flow' marketing, no profit promises; scorecards are honest hindsight; tick volume per bar only; no detection details beyond generic wording.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const PRICE_USD = 33; // set by the owner
const ROOT = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m18-at24-indicators");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const FOOT = `\n\nDescriptive history on your own broker data. Context tool, not a signal or a forecast; it draws zones and levels and never places orders; it uses tick volume per bar, not true order flow; the scorecards are hindsight on past bars and past results do not predict future results. Not financial advice. Not financial advice. Trading leveraged products is risky.`;

const LICENCE = `\n\nLICENCE KEY: the download is protected by your AT24 licence key. One key works on ONE trading account at a time and only for this product; you can move it to another account yourself (2 changes per 30 days) from Dashboard > Purchases. After buying, paste the key from your purchase page into the EA input "InpLicenseKey" and allow https://www.algotraders24.ai under Tools > Options > Expert Advisors > Allow WebRequest. The Strategy Tester needs no key.`;

const RESULT = `XAUUSD M15 on an IC Markets demo feed: sellers-absorbed zones 67 retests, hit rate 40%, average +0.17 R after cost (luck test p 0.19, NO EDGE SHOWN); buyers-absorbed zones 47 retests, hit rate 23%, average -0.34 R (NEGATIVE ON THIS HISTORY); all zones 114 retests, average -0.04 R (p 0.62, NO EDGE SHOWN). Hindsight on past bars, no edge claimed.`;

type Product = { slug: string; title: string; tradingSystemId: string; version: string; platform: string; zip: string; banner: string; tags: string[]; description: string };

const PRODUCTS: Product[] = [
  {
    slug: "at24-absorption-map",
    title: "AT24 Absorption Map",
    tradingSystemId: "AT24-ABSORPTION-MAP",
    version: "1.00",
    platform: "MT5",
    zip: "AT24_AbsorptionMap_MT5_v1.00.zip",
    banner: "absorption-map-banner.png",
    tags: ["indicator", "absorption", "tick-volume", "zones", "scorecard", "research", "dashboard", "gold", "mt5", "demo-tested"],
    description: `AT24 Absorption Map marks zones where heavy tick volume met a small price range, and scores how the first retest of past zones really turned out on your chart.

The idea is simple: unusual activity with little price movement can mark a level that later matters. Whether it did on your symbol is a measurable question, so Absorption Map measures it instead of assuming it.

What you get
- Zones drawn on closed bars from tick volume per bar (not true order flow).
- A ready plan for the nearest fresh zone on each side: limit, stop and target.
- First-retest scorecards for every past zone: retests, hit rate, average R after cost and a luck test. The verdict only says positive or negative when the result is beyond luck, and shows TOO FEW under 30.
- Optional touch alert once per bar. It never places orders.

The scorecards are hindsight on past bars. Past results do not predict future results, and zones often show no edge. Not financial advice.

It is delivered as a non-trading utility Expert Advisor with the indicator built into the file (MT5 does not allow licence checks inside indicators): attach it to a chart and the dashboard appears.

What was verified: compiles with 0 errors and 0 warnings in the real MetaEditor and runs on a real MT5 chart (see the screenshot). The whole chain matches an independent Python calculation (94 zones, 89 trades, all identical). Not verified: the touch alert on a live connected chart and the drawing of fresh zones on every symbol.
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
    await copyFile(path.join(ROOT, "branding", "absorption_map-icon.png"), path.join(mediaDir, "icon2.png"));
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

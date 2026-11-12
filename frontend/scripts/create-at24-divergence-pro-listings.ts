// scripts/create-at24-divergence-pro-listings.ts
// AT24 Divergence Pro - MT5 (licensed non-trading utility EA that embeds the indicator), 11 USD.
//   npx tsx scripts/create-at24-divergence-pro-listings.ts            -> creates/updates the listings as DRAFT (not visible)
//   npx tsx scripts/create-at24-divergence-pro-listings.ts --publish  -> also sets publicationState PUBLISHED
// MT5 tradingSystemId doubles as the licence gate's product id (AT24-DIVERGENCE-PRO).
// Claims rule: no 'reversal signals', no profit or win-rate promises; scorecards are honest hindsight and a verdict appears only beyond luck; no divergence-definition details in the listing text.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const PRICE_USD = 33; // set by the owner
const ROOT = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m18-at24-indicators");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const FOOT = `\n\nDescriptive history on your own broker data. Context tool, not a signal or a forecast; it draws divergences and levels and never places orders; the scorecards are hindsight on past bars, past results do not predict future results, and most groups show no edge beyond luck. Not financial advice. Not financial advice. Trading leveraged products is risky.`;

const LICENCE = `\n\nLICENCE KEY: the download is protected by your AT24 licence key. One key works on ONE trading account at a time and only for this product; you can move it to another account yourself (2 changes per 30 days) from Dashboard > Purchases. After buying, paste the key from your purchase page into the EA input "InpLicenseKey" and allow https://www.algotraders24.ai under Tools > Options > Expert Advisors > Allow WebRequest. The Strategy Tester needs no key.`;

const RESULT = `XAUUSD M15 on one broker demo feed, last 8,000 bars: bullish 47 trades, hit rate 36%, average -0.05 R after cost (luck test p 0.61); bearish 43 trades, hit rate 47%, average +0.18 R (p 0.19); all 81 trades, average +0.08 R (p 0.29). All three: NO EDGE SHOWN. Hindsight statistics on past bars only.`;

type Product = { slug: string; title: string; tradingSystemId: string; version: string; platform: string; zip: string; banner: string; tags: string[]; description: string };

const PRODUCTS: Product[] = [
  {
    slug: "at24-divergence-pro",
    title: "AT24 Divergence Pro",
    tradingSystemId: "AT24-DIVERGENCE-PRO",
    version: "1.00",
    platform: "MT5",
    zip: "AT24_DivergencePro_MT5_v1.00.zip",
    banner: "divergence-pro-banner.png",
    tags: ["indicator", "divergence", "rsi", "scorecard", "research", "dashboard", "gold", "mt5", "demo-tested"],
    description: `AT24 Divergence Pro marks RSI divergences that cannot repaint and scores how past divergences did on your chart.

Divergence indicators are popular and often repaint: a swing appears, then moves or vanishes. Divergence Pro uses a swing only after the bars to its right have closed, and then grades every past divergence - including when the answer is 'no edge'.

What you get
- Divergence lines and arrows on closed bars, so nothing repaints (the signal comes a few bars after the swing).
- A plan for a live divergence: entry, stop and target.
- Scorecards for bullish, bearish and all divergences: number of trades, hit rate, average R after cost and a luck test. The verdict only says positive or negative when the result is beyond luck, and shows TOO FEW under 30.
- Optional alert and push at bar close. It never places orders.

The scorecards are hindsight on past bars. Past results on this symbol do not predict future results, and divergences often show no edge. Not financial advice.

It is delivered as a non-trading utility Expert Advisor with the indicator built into the file (MT5 does not allow licence checks inside indicators): attach it to a chart and the dashboard appears.

What was verified: compiles with 0 errors and 0 warnings in the real MetaEditor and runs on a real MT5 XAUUSD chart (see the screenshot). The whole chain matches an independent Python calculation (104 divergences, 85 trades, all identical). Not verified: the live-divergence block and alerts on a live connected chart.
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
    await copyFile(path.join(ROOT, "branding", "divergence_pro-icon.png"), path.join(mediaDir, "icon2.png"));
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

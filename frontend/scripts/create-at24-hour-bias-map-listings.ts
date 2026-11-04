// scripts/create-at24-hour-bias-map-listings.ts
// AT24 Hour Bias Map - MT5 (licensed non-trading utility EA that embeds the indicator), 11 USD.
//   npx tsx scripts/create-at24-hour-bias-map-listings.ts            -> creates/updates the listings as DRAFT (not visible)
//   npx tsx scripts/create-at24-hour-bias-map-listings.ts --publish  -> also sets publicationState PUBLISHED
// MT5 tradingSystemId doubles as the licence gate's product id (AT24-HOUR-BIAS-MAP).
// Claims rule: descriptive history only; no "trade this hour", no "best hour to buy", no win rates; the one clear hour is in-sample on a strongly rising gold market, untested out of sample and possibly a market-reopening artifact; costs were not studied.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const PRICE_USD = 22; // set by the owner
const ROOT = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m18-at24-indicators");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const FOOT = `\n\nDescriptive history on your own broker data. Context tool, not a signal or a forecast; it prints no buy or sell arrows and never places orders; hours use the New York clock (daylight-saving aware) and the history length, so other symbols and lengths differ; gold's long-run upward drift lifts most hours. Not financial advice. Trading leveraged products is risky.`;

const LICENCE = `\n\nLICENCE KEY: the download is protected by your AT24 licence key. One key works on ONE trading account at a time and only for this product; you can move it to another account yourself (2 changes per 30 days) from Dashboard > Purchases. After buying, paste the key from your purchase page into the EA input "InpLicenseKey" and allow https://www.algotraders24.ai under Tools > Options > Expert Advisors > Allow WebRequest. The Strategy Tester needs no key.`;

const RESULT = `Real result on one broker feed (XAUUSD H1, 15,485 hourly bars, about 2.6 years): exactly one of 23 New York hours was statistically clear - NY 18:00, the first hour after the daily break, at about +3.8 bp per hour (t 3.67, up in 58.7% of those hours, positive in both halves). Every other hour was within chance, and the first-half pattern did not predict the second half (correlation -0.04). A second broker feed (21,650 hourly bars) gave the same picture: one clear hour, and only 10 of 24 hours kept the same sign in both halves. Gold rose strongly over the period, which lifts most hours, and the one clear hour is untested out of sample and may be a market-reopening effect - we make no trading claim. This is descriptive and not an edge.`;

type Product = { slug: string; title: string; tradingSystemId: string; version: string; platform: string; zip: string; banner: string; tags: string[]; description: string };

const PRODUCTS: Product[] = [
  {
    slug: "at24-hour-bias-map",
    title: "AT24 Hour Bias Map (MT5)",
    tradingSystemId: "AT24-HOUR-BIAS-MAP",
    version: "1.01",
    platform: "MT5",
    zip: "AT24_HourBiasMap_MT5_v1.01.zip",
    banner: "hour-bias-map-banner.png",
    tags: ["indicator", "hour-of-day", "seasonality", "new-york", "statistics", "t-test", "dashboard", "gold", "xauusd", "mt5", "demo-tested"],
    description: `'Gold rises in the Asian session', 'never trade the 11 o'clock hour': hour-of-day claims are everywhere and rarely tested. AT24 Hour Bias Map shows the mean return per New York hour (daylight-saving aware) as a histogram with t-statistics, highlights the current hour, and does the check most posts skip: how many of 24 hours look significant versus what chance alone gives, and whether the pattern in the first half of the history held in the second half.

What you get
- A histogram of the mean return per New York hour in basis points, the current hour highlighted, with its t-statistic, share of up hours and sample size.
- A chance check: how many of the 24 hours pass |t| >= 1.96 and |t| >= 3, against the roughly one that chance alone gives.
- A persistence check: the correlation between the first-half and second-half pattern and how many hours kept the same sign.
- Works on any chart timeframe from the symbol's H1 history (900 days by default).

It is delivered as a non-trading utility Expert Advisor with the indicator built into the file (MT5 does not allow licence checks inside indicators): attach it to a chart and the histogram and dashboard appear.

What was verified: compiles with 0 errors and 0 warnings in the real MetaEditor and runs on a real MT5 XAUUSD chart (see the screenshot). The New York hour conversion equals the standard time-zone database on all bars and the statistics match an independent Python calculation (identical).
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
    await copyFile(path.join(ROOT, "branding", "hour_bias_map-icon.png"), path.join(mediaDir, "icon2.png"));
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

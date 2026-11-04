// scripts/create-at24-weekend-gap-tracker-listings.ts
// AT24 Weekend Gap Tracker - MT5 (licensed non-trading utility EA that embeds the indicator), 11 USD.
//   npx tsx scripts/create-at24-weekend-gap-tracker-listings.ts            -> creates/updates the listings as DRAFT (not visible)
//   npx tsx scripts/create-at24-weekend-gap-tracker-listings.ts --publish  -> also sets publicationState PUBLISHED
// MT5 tradingSystemId doubles as the licence gate's product id (AT24-WEEKEND-GAP-TRACKER).
// Claims rule: descriptive history only; no "trade the gap fill", no edge, no win rate (gaps filled no more often than a control level the same distance away); results depend on the gap-size threshold and the market.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const PRICE_USD = 22; // set by the owner
const ROOT = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m18-at24-indicators");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const FOOT = `\n\nDescriptive history on your own broker data. Context tool, not a signal or a forecast; it prints no buy or sell arrows and never places orders; a gap is any break of more than 12 hours between hourly bars (weekends and long holiday closures) of at least 0.1 ATR, and other thresholds change the counts. Not financial advice. Trading leveraged products is risky.`;

const LICENCE = `\n\nLICENCE KEY: the download is protected by your AT24 licence key. One key works on ONE trading account at a time and only for this product; you can move it to another account yourself (2 changes per 30 days) from Dashboard > Purchases. After buying, paste the key from your purchase page into the EA input "InpLicenseKey" and allow https://www.algotraders24.ai under Tools > Options > Expert Advisors > Allow WebRequest. The Strategy Tester needs no key.`;

const RESULT = `Real result on one broker feed (XAUUSD H1, last 900 days, 149 gaps of at least 0.1 ATR, typical size about 0.40 ATR): price came back to Friday's close within 1 / 4 / 24 hours and 5 days in about 57 / 68 / 83 / 90% of cases, while a control level at the same distance on the other side was reached in about 51 / 72 / 86 / 92%. A second broker feed (136 gaps) gave 51 / 66 / 82 / 90% against 54 / 74 / 87 / 92%. In other words a weekend gap fills about as often as any level that near. This is descriptive, depends on the gap-size threshold, and is not an edge.`;

type Product = { slug: string; title: string; tradingSystemId: string; version: string; platform: string; zip: string; banner: string; tags: string[]; description: string };

const PRODUCTS: Product[] = [
  {
    slug: "at24-weekend-gap-tracker",
    title: "AT24 Weekend Gap Tracker (MT5)",
    tradingSystemId: "AT24-WEEKEND-GAP-TRACKER",
    version: "1.01",
    platform: "MT5",
    zip: "AT24_WeekendGapTracker_MT5_v1.01.zip",
    banner: "weekend-gap-tracker-banner.png",
    tags: ["indicator", "weekend-gap", "gap-fill", "gaps", "statistics", "dashboard", "gold", "xauusd", "mt5", "demo-tested"],
    description: `'Gaps always fill' is repeated everywhere and rarely checked. AT24 Weekend Gap Tracker finds the latest weekend (market-closed) gap, shows Friday's closing price and whether the gap has been filled, and measures on your own symbol how often gaps were filled within 1 hour, 4 hours, 1 day and 5 days - against a control level at the same distance on the other side.

What you get
- The latest gap: Friday close, reopening price, size in points and ATR, the direction and the fill status, drawn as a zone with the Friday-close line while it is open.
- Real history on your own data (900 days of H1): gaps measured, typical size, share up, and the fill rates at 1 hour, 4 hours, 1 day and 5 days next to the control level.
- Works on any chart timeframe. Optional alert when the gap is filled.

It is delivered as a non-trading utility Expert Advisor with the indicator built into the file (MT5 does not allow licence checks inside indicators): attach it to a chart and the zone and dashboard appear.

What was verified: compiles with 0 errors and 0 warnings in the real MetaEditor and runs on a real MT5 XAUUSD chart (see the screenshot). The gaps and statistics match an independent Python calculation (all 137 gaps identical).
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
    await copyFile(path.join(ROOT, "branding", "weekend_gap_tracker-icon.png"), path.join(mediaDir, "icon2.png"));
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

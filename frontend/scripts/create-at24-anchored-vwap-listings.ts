// scripts/create-at24-anchored-vwap-listings.ts
// AT24 Anchored VWAP - MT5 (licensed non-trading utility EA that embeds the indicator), 11 USD.
//   npx tsx scripts/create-at24-anchored-vwap-listings.ts            -> creates/updates the listings as DRAFT (not visible)
//   npx tsx scripts/create-at24-anchored-vwap-listings.ts --publish  -> also sets publicationState PUBLISHED
// MT5 tradingSystemId doubles as the licence gate's product id (AT24-ANCHORED-VWAP).
// Claims rule: descriptive history only; no "VWAP reversion strategy", no win rate, no edge (VWAP drifts toward price during the day, which makes touching it easier; a touch is not a profit); volume is TICK volume, not exchange volume.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const PRICE_USD = 22; // set by the owner
const ROOT = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m18-at24-indicators");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const FOOT = `\n\nDescriptive history on your own broker data. Context tool, not a signal or a forecast; it prints no buy or sell arrows and never places orders; volume is TICK volume from the broker feed (not real traded volume), the day, week and month anchors are in GMT with a daylight-saving aware broker clock, and costs are ignored. Not financial advice. Trading leveraged products is risky.`;

const LICENCE = `\n\nLICENCE KEY: the download is protected by your AT24 licence key. One key works on ONE trading account at a time and only for this product; you can move it to another account yourself (2 changes per 30 days) from Dashboard > Purchases. After buying, paste the key from your purchase page into the EA input "InpLicenseKey" and allow https://www.algotraders24.ai under Tools > Options > Expert Advisors > Allow WebRequest. The Strategy Tester needs no key.`;

const RESULT = `Real result on one broker feed (XAUUSD M15, last 8,000 bars, 84 days measured, tick volume): after the first close 2 standard deviations from the day VWAP, price traded back to the VWAP before the day ended on about 77% of days, went on to a 3 SD close on about 15% and neither on about 7%; about 48% of closes were above the day VWAP. A random-walk yardstick for those barriers is about 33%, but the VWAP drifts toward price during the day, which makes touching it easier - so this is NOT an edge and not a strategy: a touch is not a profit, stretches can run first and costs are ignored. Another broker feed gave 77 / 14 / 9% over 86 days.`;

type Product = { slug: string; title: string; tradingSystemId: string; version: string; platform: string; zip: string; banner: string; tags: string[]; description: string };

const PRODUCTS: Product[] = [
  {
    slug: "at24-anchored-vwap",
    title: "AT24 Anchored VWAP (MT5)",
    tradingSystemId: "AT24-ANCHORED-VWAP",
    version: "1.01",
    platform: "MT5",
    zip: "AT24_AnchoredVwap_MT5_v1.01.zip",
    banner: "anchored-vwap-banner.png",
    tags: ["indicator", "vwap", "anchored-vwap", "bands", "tick-volume", "statistics", "dashboard", "gold", "xauusd", "mt5", "demo-tested"],
    description: `Traders use VWAP as 'fair value' but rarely see how price really behaves around it on their own data. AT24 Anchored VWAP draws the day VWAP with +-1 and +-2 standard-deviation bands plus the week and month VWAP, shows how many standard deviations price is from each, and measures the last days: after a close 2 SD from the day VWAP, how often price came back to the VWAP, how often it went on to 3 SD, and how often it closes above the VWAP.

What you get
- Day, week (Monday) and month VWAP lines with the day's +-1 / +-2 SD bands, built from the broker's tick volume.
- A dashboard with the state (above or below the day VWAP, in SD) and the distance to the week and month VWAP.
- Real history on your own data: the reversion test with the random-walk yardstick next to it, so you can judge the number yourself.
- Anchors in GMT with a daylight-saving aware broker clock. Optional alerts.

It is delivered as a non-trading utility Expert Advisor with the indicator built into the file (MT5 does not allow licence checks inside indicators): attach it to a chart and the lines and dashboard appear.

What was verified: compiles with 0 errors and 0 warnings in the real MetaEditor and runs on a real MT5 XAUUSD M15 chart (see the screenshot). The VWAP, SD and the reversion statistics match an independent Python calculation (identical).
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
    await copyFile(path.join(ROOT, "branding", "anchored_vwap-icon.png"), path.join(mediaDir, "icon2.png"));
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

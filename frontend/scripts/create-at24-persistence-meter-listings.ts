// scripts/create-at24-persistence-meter-listings.ts
// AT24 Persistence Meter - MT5 (licensed non-trading utility EA that embeds the indicator), 11 USD.
//   npx tsx scripts/create-at24-persistence-meter-listings.ts            -> creates/updates the listings as DRAFT (not visible)
//   npx tsx scripts/create-at24-persistence-meter-listings.ts --publish  -> also sets publicationState PUBLISHED
// MT5 tradingSystemId doubles as the licence gate's product id (AT24-PERSISTENCE-METER).
// Claims rule: descriptive history only; no "trend filter that works", no "mean-reversion signal": on our data the reading did not demonstrably predict the next move; it shows its own uncertainty (n and 95% intervals).
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const PRICE_USD = 22; // set by the owner
const ROOT = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m18-at24-indicators");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const FOOT = `\n\nDescriptive history on your own broker data. Context tool, not a signal or a forecast; it prints no buy or sell arrows and never places orders; a variance-ratio reading says something about serial correlation in the recent window only, can flip quickly, and changes with window and move length; H1 or lower charts only. Not financial advice. Trading leveraged products is risky.`;

const LICENCE = `\n\nLICENCE KEY: the download is protected by your AT24 licence key. One key works on ONE trading account at a time and only for this product; you can move it to another account yourself (2 changes per 30 days) from Dashboard > Purchases. After buying, paste the key from your purchase page into the EA input "InpLicenseKey" and allow https://www.algotraders24.ai under Tools > Options > Expert Advisors > Allow WebRequest. The Strategy Tester needs no key.`;

const RESULT = `Real result on one broker feed (XAUUSD M15, 234 non-overlapping 32-bar windows): the meter said moves tend to continue in about 3% of windows (7), tend to reverse in about 18% (43) and random in about 79%. The next move went the same way as the last one about 54% of the time overall (+-6 points). After a 'continue' reading it was about 71%, but on only 7 windows (+-33 points); after 'reverse' about 49% on 43 windows (+-15). Neither differs from the overall rate beyond noise - the reading did not demonstrably predict the next move. The dashboard always shows the sample size and 95% interval. This is descriptive and not an edge.`;

type Product = { slug: string; title: string; tradingSystemId: string; version: string; platform: string; zip: string; banner: string; tags: string[]; description: string };

const PRODUCTS: Product[] = [
  {
    slug: "at24-persistence-meter",
    title: "AT24 Persistence Meter (MT5)",
    tradingSystemId: "AT24-PERSISTENCE-METER",
    version: "1.01",
    platform: "MT5",
    zip: "AT24_PersistenceMeter_MT5_v1.01.zip",
    banner: "persistence-meter-banner.png",
    tags: ["indicator", "variance-ratio", "hurst", "trend", "mean-reversion", "statistics", "dashboard", "gold", "xauusd", "mt5", "demo-tested"],
    description: `Traders choose 'trend' or 'mean reversion' by feel. AT24 Persistence Meter runs a standard statistical test (variance ratio) on the last bars at three move lengths and states plainly whether moves tend to continue, reverse or look random, with the exponent and z-score. Then it checks the claim on your own symbol: how often the reading was each state and whether the next move really went the same way as the last one - always with sample sizes and 95% intervals.

What you get
- Variance ratio, z-score and exponent for 4-, 8- and 16-bar moves, and a state in plain words.
- A study on your own data: the share of windows in each state and how often the next move followed the last one, overall and after each reading, with n and 95% intervals shown on screen.
- It is honest about its uncertainty: on our test the reading did not demonstrably predict the next move. H1 or lower charts only.

It is delivered as a non-trading utility Expert Advisor with the indicator built into the file (MT5 does not allow licence checks inside indicators): attach it to a chart and the dashboard appears.

What was verified: compiles with 0 errors and 0 warnings in the real MetaEditor and runs on a real MT5 XAUUSD M15 chart (see the screenshot). The statistics match an independent Python calculation (90 spot checks and the full study identical).
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
    await copyFile(path.join(ROOT, "branding", "persistence_meter-icon.png"), path.join(mediaDir, "icon2.png"));
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

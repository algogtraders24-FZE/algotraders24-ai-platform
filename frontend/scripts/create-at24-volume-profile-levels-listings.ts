// scripts/create-at24-volume-profile-levels-listings.ts
// AT24 Volume Profile Levels - MT5 (licensed non-trading utility EA that embeds the indicator), 11 USD.
//   npx tsx scripts/create-at24-volume-profile-levels-listings.ts            -> creates/updates the listings as DRAFT (not visible)
//   npx tsx scripts/create-at24-volume-profile-levels-listings.ts --publish  -> also sets publicationState PUBLISHED
// MT5 tradingSystemId doubles as the licence gate's product id (AT24-VOLUME-PROFILE-LEVELS).
// Claims rule: descriptive history only; no "POC is support/resistance", no "value area reversion", no win rate, no edge (reaction rates are within noise); it uses broker TICK volume, not exchange volume.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const PRICE_USD = 22; // set by the owner
const ROOT = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m18-at24-indicators");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const FOOT = `\n\nDescriptive history on your own broker data. Context tool, not a signal or a forecast; it prints no buy or sell arrows and never places orders; the profile is built from the broker's TICK volume (CFD and FX have no exchange volume), so another broker's feed gives a different profile; H1 or lower charts only. Not financial advice. Trading leveraged products is risky.`;

const LICENCE = `\n\nLICENCE KEY: the download is protected by your AT24 licence key. One key works on ONE trading account at a time and only for this product; you can move it to another account yourself (2 changes per 30 days) from Dashboard > Purchases. After buying, paste the key from your purchase page into the EA input "InpLicenseKey" and allow https://www.algotraders24.ai under Tools > Options > Expert Advisors > Allow WebRequest. The Strategy Tester needs no key.`;

const RESULT = `Real result on one broker feed (XAUUSD M15, last 87 days, tick volume): yesterday's POC was touched on about 74% of days (a mirrored control level about 61%) and price reacted away from it about 49% of the time (+-13; control about 45%); VAH touched about 72% (control 60%), reacted about 59% (control about 60%); VAL touched about 68% (control 61%), reacted about 60% (control about 47%). The levels were touched somewhat more often than control levels, but the reaction rates are within noise of the controls. This is descriptive, a small sample, tick volume (not exchange volume), and not an edge.`;

type Product = { slug: string; title: string; tradingSystemId: string; version: string; platform: string; zip: string; banner: string; tags: string[]; description: string };

const PRODUCTS: Product[] = [
  {
    slug: "at24-volume-profile-levels",
    title: "AT24 Volume Profile Levels (MT5)",
    tradingSystemId: "AT24-VOLUME-PROFILE-LEVELS",
    version: "1.01",
    platform: "MT5",
    zip: "AT24_VolumeProfileLevels_MT5_v1.01.zip",
    banner: "volume-profile-levels-banner.png",
    tags: ["indicator", "volume-profile", "poc", "value-area", "levels", "tick-volume", "statistics", "dashboard", "gold", "xauusd", "mt5", "demo-tested"],
    description: `Point of control (POC) and value area levels are popular, but most tools only draw them. AT24 Volume Profile Levels builds yesterday's volume profile from your broker's tick volume (CFD and FX have no exchange volume), draws the POC, VAH and VAL and the shaded value area across today, says whether price is inside, above or below, and measures on your own symbol how often price touched these levels and whether it reacted - against mirrored control levels.

What you get
- Yesterday's POC / VAH / VAL as lines and a shaded value area across today, with labels.
- A state (inside / above / below the value area) and the distance from the POC.
- Real history on your own data: how often each level was touched and how often price reacted away from it before breaking it, next to the control levels. Optional alerts.
- Honest about its data: tick volume from the broker feed, so another broker gives a different profile. H1 or lower charts only.

It is delivered as a non-trading utility Expert Advisor with the indicator built into the file (MT5 does not allow licence checks inside indicators): attach it to a chart and the levels and dashboard appear.

What was verified: compiles with 0 errors and 0 warnings in the real MetaEditor and runs on a real MT5 XAUUSD M15 chart (see the screenshot). The profiles and the three level studies match an independent Python calculation (all 88 daily profiles identical).
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
    await copyFile(path.join(ROOT, "branding", "volume_profile_levels-icon.png"), path.join(mediaDir, "icon2.png"));
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

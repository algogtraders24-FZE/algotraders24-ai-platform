// scripts/create-at24-forward-ledger-listings.ts
// AT24 Forward Ledger - MT5 (licensed non-trading utility EA that embeds the indicator), 11 USD.
//   npx tsx scripts/create-at24-forward-ledger-listings.ts            -> creates/updates the listings as DRAFT (not visible)
//   npx tsx scripts/create-at24-forward-ledger-listings.ts --publish  -> also sets publicationState PUBLISHED
// MT5 tradingSystemId doubles as the licence gate's product id (AT24-FORWARD-LEDGER).
// Claims rule: transparency only; no claim that any registered rule has an edge, no profit claim, no 'signal' or 'strategy'; results are out-of-sample by construction but tell nothing about the future.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const PRICE_USD = 22; // set by the owner
const ROOT = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m18-at24-indicators");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const FOOT = `\n\nDescriptive history on your own broker data. Context tool, not a signal or a forecast; it is a research ledger: it replays closed bars, places no trades and prints no buy or sell arrows; no costs are subtracted in the ledger and a collecting or 'no edge so far' reading is the normal outcome. Not financial advice. Trading leveraged products is risky.`;

const LICENCE = `\n\nLICENCE KEY: the download is protected by your AT24 licence key. One key works on ONE trading account at a time and only for this product; you can move it to another account yourself (2 changes per 30 days) from Dashboard > Purchases. After buying, paste the key from your purchase page into the EA input "InpLicenseKey" and allow https://www.algotraders24.ai under Tools > Options > Expert Advisors > Allow WebRequest. The Strategy Tester needs no key.`;

const RESULT = `After four days the ledger shows every rule still 'collecting' (fewer than 30 trades each; the fifth rule has none yet) - the honest starting point. A rule only gets a verdict after enough trades, and only when it beats chance after correcting for the number of rules registered (five). Most ideas never will; that is the point of the ledger.`;

type Product = { slug: string; title: string; tradingSystemId: string; version: string; platform: string; zip: string; banner: string; tags: string[]; description: string };

const PRODUCTS: Product[] = [
  {
    slug: "at24-forward-ledger",
    title: "AT24 Forward Ledger (MT5)",
    tradingSystemId: "AT24-FORWARD-LEDGER",
    version: "1.02",
    platform: "MT5",
    zip: "AT24_ForwardLedger_MT5_v1.02.zip",
    banner: "forward-ledger-banner.png",
    tags: ["indicator", "research", "out-of-sample", "forward-test", "pre-registered", "statistics", "dashboard", "gold", "mt5", "demo-tested"],
    description: `Almost every 'edge' online is found by looking at history and then tested on the same history. AT24 Forward Ledger does the opposite: a candidate rule is written down with a date, and only what happens after that date counts. It shows, live, how many trades each rule has made, the average return, the average net of the market's own drift, a t-statistic and a verdict that only turns green when the result beats chance after correcting for the number of rules registered (five).

What you get
- Five research candidate rules registered with dates (shown on the dashboard; one uses the broker's USD economic calendar, which your broker must provide), each tallied out-of-sample from its own start date.
- Trades so far, mean return, mean net of drift, t-statistic and a plain verdict: collecting, no edge so far, or positive/negative so far.
- Recomputed from your own broker's closed hourly bars: nothing is stored or sent. The broker clock is detected automatically (other FX pairs are tried if the chart symbol cannot be used) and can be set by hand.
- A labelled REPLAY mode that shows how misleading in-sample numbers can be.

It is delivered as a non-trading utility Expert Advisor with the indicator built into the file (MT5 does not allow licence checks inside indicators): attach it to a chart and the dashboard appears.

What was verified: compiles with 0 errors and 0 warnings in the real MetaEditor and runs on a real MT5 XAUUSD chart (see the screenshot). The ledger engine matches an independent Python calculation (identical numbers across the registered rules and start dates). Not verified: the calendar-based rule on every broker's calendar feed.
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
    await copyFile(path.join(ROOT, "branding", "forward_ledger-icon.png"), path.join(mediaDir, "icon2.png"));
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

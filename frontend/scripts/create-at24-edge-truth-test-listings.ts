// scripts/create-at24-edge-truth-test-listings.ts
// AT24 Edge Truth Test - MT5 (licensed non-trading utility EA that embeds the indicator), 11 USD.
//   npx tsx scripts/create-at24-edge-truth-test-listings.ts            -> creates/updates the listings as DRAFT (not visible)
//   npx tsx scripts/create-at24-edge-truth-test-listings.ts --publish  -> also sets publicationState PUBLISHED
// MT5 tradingSystemId doubles as the licence gate's product id (AT24-EDGE-TRUTH-TEST).
// Claims rule: a pass means luck alone is unlikely for THIS trade list, never a lasting-edge claim; no profit claim; a list under 30 trades gets no verdict.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const PRICE_USD = 22; // set by the owner
const ROOT = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m18-at24-indicators");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const FOOT = `\n\nDescriptive history on your own broker data. Context tool, not a signal or a forecast; it only reads your closed-trade history, places and modifies no trades and prints no buy or sell arrows; a pass says luck alone is unlikely for this list, not that the edge will last, and a fail does not prove there is none. Not financial advice. Trading leveraged products is risky.`;

const LICENCE = `\n\nLICENCE KEY: the download is protected by your AT24 licence key. One key works on ONE trading account at a time and only for this product; you can move it to another account yourself (2 changes per 30 days) from Dashboard > Purchases. After buying, paste the key from your purchase page into the EA input "InpLicenseKey" and allow https://www.algotraders24.ai under Tools > Options > Expert Advisors > Allow WebRequest. The Strategy Tester needs no key.`;

const RESULT = `The screenshot uses the built-in SAMPLE trade list, labelled on the dashboard as sample data - it only shows how the display works and is NOT a result for any real account. Run once on a real demo account with 276 closed trades, the tool returned 'cannot be told from luck'. A pass means luck alone is unlikely for that list; it never proves a lasting edge.`;

type Product = { slug: string; title: string; tradingSystemId: string; version: string; platform: string; zip: string; banner: string; tags: string[]; description: string };

const PRODUCTS: Product[] = [
  {
    slug: "at24-edge-truth-test",
    title: "AT24 Edge Truth Test (MT5)",
    tradingSystemId: "AT24-EDGE-TRUTH-TEST",
    version: "1.00",
    platform: "MT5",
    zip: "AT24_EdgeTruthTest_MT5_v1.00.zip",
    banner: "edge-truth-test-banner.png",
    tags: ["indicator", "statistics", "trade-journal", "backtest", "significance", "bootstrap", "dashboard", "gold", "mt5", "demo-tested"],
    description: `Most traders judge an account or a backtest by the profit number alone. AT24 Edge Truth Test asks the harder question on your own closed trades: could luck alone have produced this result?

What you get
- A sign-flip test: a p-value for the profit against chance.
- A bootstrap 90% range for where the total could end up with the same trades, and the chance of a loss.
- A drawdown check: is your worst drawdown bad luck or normal for this list of trades, compared with the same trades in shuffled orders.
- A plain verdict, shown only with 30 or more trades. Filter by symbol, magic number or the last N days.
- It is read-only: it never places or modifies trades. A pass says luck alone is unlikely for THIS list - not that the edge will last.

It is delivered as a non-trading utility Expert Advisor with the indicator built into the file (MT5 does not allow licence checks inside indicators): attach it to a chart and the dashboard appears.

What was verified: compiles with 0 errors and 0 warnings in the real MetaEditor and runs on a real MT5 chart. The test engine matches an independent Python calculation (four trade lists, fourteen numbers each, deterministic random generator, fixed seed), and the trade-history path ran once on a demo account with 276 closed trades and produced a verdict. The screenshot uses a built-in labelled SAMPLE list.
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
    await copyFile(path.join(ROOT, "branding", "edge_truth_test-icon.png"), path.join(mediaDir, "icon2.png"));
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

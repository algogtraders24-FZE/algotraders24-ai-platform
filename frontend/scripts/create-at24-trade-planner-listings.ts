// scripts/create-at24-trade-planner-listings.ts
// AT24 Trade Planner - MT5 (licensed non-trading utility EA that embeds the indicator), 11 USD.
//   npx tsx scripts/create-at24-trade-planner-listings.ts            -> creates/updates the listings as DRAFT (not visible)
//   npx tsx scripts/create-at24-trade-planner-listings.ts --publish  -> also sets publicationState PUBLISHED
// MT5 tradingSystemId doubles as the licence gate's product id (AT24-TRADE-PLANNER).
// Claims rule: a planning calculator only: it places no orders; no 'guarantees your loss is limited' (spread, slippage and gaps can make a real loss larger than planned); not broker-exact until checked on a live quote; no profit or win-rate claims.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const PRICE_USD = 33; // set by the owner
const ROOT = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m18-at24-indicators");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const FOOT = `\n\nDescriptive history on your own broker data. Context tool, not a signal or a forecast; it is a planning calculator: it never places, modifies or closes trades and prints no buy or sell arrows; spread, slippage and gaps can make a real loss larger than the planned stop, so always check the lot size in your platform before trading. Not financial advice. Not financial advice. Trading leveraged products is risky.`;

const LICENCE = `\n\nLICENCE KEY: the download is protected by your AT24 licence key. One key works on ONE trading account at a time and only for this product; you can move it to another account yourself (2 changes per 30 days) from Dashboard > Purchases. After buying, paste the key from your purchase page into the EA input "InpLicenseKey" and allow https://www.algotraders24.ai under Tools > Options > Expert Advisors > Allow WebRequest. The Strategy Tester needs no key.`;

const RESULT = `Calculator, not a results product. On the demo terminal a 0.01 lot XAUUSD plan with a 14.08 stop and a 28.16 target showed 14.08 USD at risk and 28.16 USD at the target, matching the contract-size arithmetic. It has not yet been checked against the platform's own order calculator or margin figure on a live quote, so check the lot size in your platform before trading.`;

type Product = { slug: string; title: string; tradingSystemId: string; version: string; platform: string; zip: string; banner: string; tags: string[]; description: string };

const PRODUCTS: Product[] = [
  {
    slug: "at24-trade-planner",
    title: "AT24 Trade Planner",
    tradingSystemId: "AT24-TRADE-PLANNER",
    version: "1.00",
    platform: "MT5",
    zip: "AT24_TradePlanner_MT5_v1.00.zip",
    banner: "trade-planner-banner.png",
    tags: ["indicator", "risk", "position-size", "trade-planning", "calculator", "risk-management", "prop-firm", "dashboard", "gold", "mt5", "demo-tested"],
    description: `AT24 Trade Planner turns three draggable chart lines into lot size, money at risk, reward and trading cost.

Place Entry, Stop and Target on your chart, choose how you size risk, and the panel tells you the numbers before you click anything in your platform.

What you get
- Lot size for your risk rule: a percentage of the balance or a fixed amount of money.
- Money at the stop and at the target, and the reward-to-risk ratio.
- Margin needed, and spread plus commission as a share of the reward.
- The share of today's remaining daily loss allowance the trade would use, for prop-firm rules.
- Drag the lines and the panel follows. A wrong-side stop is flagged.

It is a planning calculator: it never places orders. Spread, slippage and gaps can make a real loss larger than planned. Not financial advice.

It is delivered as a non-trading utility Expert Advisor with the indicator built into the file (MT5 does not allow licence checks inside indicators): attach it to a chart and the panel appears.

What was verified: compiles with 0 errors and 0 warnings in the real MetaEditor and runs on a real MT5 XAUUSD chart. The planning engine matches an independent Python calculation (eight long and short scenarios, wrong-side stop rejected), and on the demo terminal the money figures matched the contract-size arithmetic. Not verified: the figures against the platform's order calculator and margin on a live quote, and dragging with the mouse on a connected terminal.
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
    await copyFile(path.join(ROOT, "branding", "trade_planner-icon.png"), path.join(mediaDir, "icon2.png"));
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

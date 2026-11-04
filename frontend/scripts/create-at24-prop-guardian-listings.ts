// scripts/create-at24-prop-guardian-listings.ts
// AT24 Prop Guardian - MT5 (licensed non-trading utility EA that embeds the indicator), 11 USD.
//   npx tsx scripts/create-at24-prop-guardian-listings.ts            -> creates/updates the listings as DRAFT (not visible)
//   npx tsx scripts/create-at24-prop-guardian-listings.ts --publish  -> also sets publicationState PUBLISHED
// MT5 tradingSystemId doubles as the licence gate's product id (AT24-PROP-GUARDIAN).
// Claims rule: a protection tool, not a guarantee: no "prevents breaches", no "passes the challenge", no firm names or affiliation; gaps, slippage and a stopped EA or VPS can still cause losses beyond a limit; it cannot switch another EA off.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const PRICE_USD = 22; // set by the owner
const ROOT = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m18-at24-indicators");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const FOOT = `\n\nDescriptive history on your own broker data. Context tool, not a signal or a forecast; it places no trades of its own and prints no buy or sell arrows; gaps, slippage and a stopped EA or stopped VPS can still cause losses beyond a limit, rules differ by firm so you set your own limits and reset hour, and it is not affiliated with any prop firm. Not financial advice. Trading leveraged products is risky.`;

const LICENCE = `\n\nLICENCE KEY: the download is protected by your AT24 licence key. One key works on ONE trading account at a time and only for this product; you can move it to another account yourself (2 changes per 30 days) from Dashboard > Purchases. After buying, paste the key from your purchase page into the EA input "InpLicenseKey" and allow https://www.algotraders24.ai under Tools > Options > Expert Advisors > Allow WebRequest. The Strategy Tester needs no key.`;

const RESULT = `This is a protection tool, not a strategy, so there are no trading results. In the Strategy Tester self-test (a test EA opening 1 lot every 10 minutes even while the account was locked; daily limit 5%, max loss 10%, act at 90%) it locked once at 94% of the max-loss limit, closed the 522 trades re-opened while locked, left no position open and raised the runaway alert once. In an earlier run with only the daily lock it unlocked at the next daily reset as designed.`;

type Product = { slug: string; title: string; tradingSystemId: string; version: string; platform: string; zip: string; banner: string; tags: string[]; description: string };

const PRODUCTS: Product[] = [
  {
    slug: "at24-prop-guardian",
    title: "AT24 Prop Guardian (MT5)",
    tradingSystemId: "AT24-PROP-GUARDIAN",
    version: "1.01",
    platform: "MT5",
    zip: "AT24_PropGuardian_MT5_v1.01.zip",
    banner: "prop-guardian-banner.png",
    tags: ["expert-advisor", "risk", "protection", "daily-loss", "max-loss", "profit-lock", "risk-management", "mt5", "demo-tested"],
    description: `Prop-style and personal loss limits are easy to write down and easy to break. AT24 Prop Guardian enforces YOUR limits: when your daily or maximum loss reaches the share of the limit you set (90% by default), it closes everything, deletes pending orders and blocks new trades - and tells you.

What you get
- Your own daily loss %, maximum loss % and an optional daily profit lock.
- Closing at the buffer (default 90% of the limit) with an alert, optional push and a dashboard; the daily lock releases at your daily reset, the maximum-loss lock needs you to press UNLOCK.
- A runaway alert when another EA keeps re-opening trades while locked.
- Optional magic-number filter, balance or equity basis and your own reset hour.
- It places no trades of its own and works with any EA or manual trading. It cannot switch another EA off; it can only close trades and alert. Keep it running 24/5 (a VPS is recommended).

It is a licensed Expert Advisor (AT24 licence key, one key per trading account). It is a protection tool, not a guarantee: gaps, slippage and a stopped EA or VPS can still cause losses beyond a limit, and firm rules differ, so set your own limits. Not affiliated with any prop firm. If the licence is invalid the Guardian is OFF.

What was verified: compiles with 0 errors and 0 warnings in the real MetaEditor, and a Strategy Tester self-test on the licensed build locked once, blocked 522 of 523 re-opened trades, left no position open and raised the runaway alert once.
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
    await copyFile(path.join(ROOT, "branding", "prop_guardian-icon.png"), path.join(mediaDir, "icon2.png"));
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

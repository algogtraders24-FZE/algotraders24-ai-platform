// scripts/create-at24-drawdown-recovery-listings.ts
// AT24 Drawdown & Recovery - MT5 (licensed non-trading utility EA that embeds the indicator), 11 USD.
//   npx tsx scripts/create-at24-drawdown-recovery-listings.ts            -> creates/updates the listings as DRAFT (not visible)
//   npx tsx scripts/create-at24-drawdown-recovery-listings.ts --publish  -> also sets publicationState PUBLISHED
// MT5 tradingSystemId doubles as the licence gate's product id (AT24-DRAWDOWN-RECOVERY).
// Claims rule: arithmetic on the user's own history only; not a forecast, no "avoid drawdown" promise; the curve is rebuilt from deal history (deposits assumed at the start) and was not cross-checked against a broker statement.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const PRICE_USD = 22; // set by the owner
const ROOT = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m18-at24-indicators");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const FOOT = `\n\nDescriptive history on your own broker data. Context tool, not a signal or a forecast; it never places, modifies or closes trades and prints no buy or sell arrows; the equity curve is rebuilt from your closed-deal history and assumes deposits and withdrawals were made at the start, so an account with later cash flows can differ from the broker's statement. Not financial advice. Trading leveraged products is risky.`;

const LICENCE = `\n\nLICENCE KEY: the download is protected by your AT24 licence key. One key works on ONE trading account at a time and only for this product; you can move it to another account yourself (2 changes per 30 days) from Dashboard > Purchases. After buying, paste the key from your purchase page into the EA input "InpLicenseKey" and allow https://www.algotraders24.ai under Tools > Options > Expert Advisors > Allow WebRequest. The Strategy Tester needs no key.`;

const RESULT = `This is a tracker and a calculator, not a strategy, so there are no trading results. On a real demo account history (269 closed deals) the panel showed the account 60.2% below its peak and +151.1% needed to get back, checked by hand. The recovery maths is exact arithmetic: a 50% loss needs +100%, a 75% loss needs +300%.`;

type Product = { slug: string; title: string; tradingSystemId: string; version: string; platform: string; zip: string; banner: string; tags: string[]; description: string };

const PRODUCTS: Product[] = [
  {
    slug: "at24-drawdown-recovery",
    title: "AT24 Drawdown & Recovery (MT5)",
    tradingSystemId: "AT24-DRAWDOWN-RECOVERY",
    version: "1.01",
    platform: "MT5",
    zip: "AT24_DrawdownRecovery_MT5_v1.01.zip",
    banner: "drawdown-recovery-banner.png",
    tags: ["indicator", "risk", "drawdown", "recovery", "equity", "losing-streak", "risk-management", "dashboard", "mt5", "demo-tested"],
    description: `Everyone knows drawdowns hurt; few traders see how much they really need to climb back. AT24 Drawdown & Recovery reads your account history, rebuilds the performance curve and shows how deep the hole is - and how big a gain it takes to get out.

What you get
- Current drawdown below the peak (with floating profit and loss), the worst drawdown on record and the gain needed to recover.
- A recovery table (a 50% loss needs +100%, a 75% loss +300%) and a losing-streak table for your own risk per trade, including how many losses in a row it takes to reach -10% and -20%.
- An optional magic-number filter for one strategy. It places no trades.
- The curve is rebuilt from your closed-deal history and assumes deposits and withdrawals at the start; it is not a forecast and was not cross-checked against a broker statement.

It is delivered as a non-trading utility Expert Advisor with the indicator built into the file (MT5 does not allow licence checks inside indicators): attach it to a chart and the panel appears. The screenshot was taken on a demo account.

What was verified: compiles with 0 errors and 0 warnings in the real MetaEditor and runs on a real MT5 chart. The tables and three synthetic equity curves match an independent calculation, and the numbers on a real demo history match hand arithmetic.
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
    await copyFile(path.join(ROOT, "branding", "drawdown_recovery-icon.png"), path.join(mediaDir, "icon2.png"));
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

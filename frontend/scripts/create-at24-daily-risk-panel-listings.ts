// scripts/create-at24-daily-risk-panel-listings.ts
// AT24 Daily Risk Panel - MT5 (licensed non-trading utility EA that embeds the indicator), 11 USD.
//   npx tsx scripts/create-at24-daily-risk-panel-listings.ts            -> creates/updates the listings as DRAFT (not visible)
//   npx tsx scripts/create-at24-daily-risk-panel-listings.ts --publish  -> also sets publicationState PUBLISHED
// MT5 tradingSystemId doubles as the licence gate's product id (AT24-DAILY-RISK-PANEL).
// Claims rule: your own rules, tracked: not a prop-firm rule checker and no guarantee you stay within any limit; it only warns and never closes or blocks trades; open-position risk was verified through the core only.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const PRICE_USD = 22; // set by the owner
const ROOT = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m18-at24-indicators");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const FOOT = `\n\nDescriptive history on your own broker data. Context tool, not a signal or a forecast; it only watches and warns: it never closes, blocks or modifies trades and prints no buy or sell arrows; it is not a prop-firm rule checker and not a guarantee you stay within any limit, and its figures should be checked against your broker's statement. Not financial advice. Trading leveraged products is risky.`;

const LICENCE = `\n\nLICENCE KEY: the download is protected by your AT24 licence key. One key works on ONE trading account at a time and only for this product; you can move it to another account yourself (2 changes per 30 days) from Dashboard > Purchases. After buying, paste the key from your purchase page into the EA input "InpLicenseKey" and allow https://www.algotraders24.ai under Tools > Options > Expert Advisors > Allow WebRequest. The Strategy Tester needs no key.`;

const RESULT = `This is a tracker, not a strategy, so there are no trading results. On a real demo account on a losing day the panel showed the day result at 228% of a 3% daily limit, 33 trades opened against a limit of 5, and 'rules broken today: 2' with the time of the last break; the figures match hand arithmetic. The open-position risk and 'position without a stop' rules were verified through the core only, because no open position was available during the test.`;

type Product = { slug: string; title: string; tradingSystemId: string; version: string; platform: string; zip: string; banner: string; tags: string[]; description: string };

const PRODUCTS: Product[] = [
  {
    slug: "at24-daily-risk-panel",
    title: "AT24 Daily Risk Panel (MT5)",
    tradingSystemId: "AT24-DAILY-RISK-PANEL",
    version: "1.01",
    platform: "MT5",
    zip: "AT24_DailyRiskPanel_MT5_v1.01.zip",
    banner: "daily-risk-panel-banner.png",
    tags: ["indicator", "risk", "daily-loss", "risk-management", "discipline", "tracker", "dashboard", "mt5", "demo-tested"],
    description: `Written-down trading rules do not stop slips; counted rules make them visible. AT24 Daily Risk Panel tracks your own daily rules on the chart - how much of your daily loss limit is used, how many trades you opened, how much risk your open positions carry and which of your rules you broke today.

What you get
- Your own rule list: daily loss limit, risk per trade, total open risk and trades per day.
- A gauge for today's loss against your limit, the trades opened, the risk to the stops of open positions, positions without a stop, and a 'rules broken today' counter with the last break. Each broken rule is counted once per day and alerts once.
- It only warns: it never closes, blocks or modifies a trade. It enforces nothing - it makes slips visible.

It is delivered as a non-trading utility Expert Advisor with the indicator built into the file (MT5 does not allow licence checks inside indicators): attach it to a chart and the panel appears. The screenshot was taken on a demo account.

What was verified: compiles with 0 errors and 0 warnings in the real MetaEditor and runs on a real MT5 chart. The core arithmetic matches an independent calculation on six scenarios, and on a real demo account on a losing day the broken-rule counter and the daily-loss gauge matched hand arithmetic. The open-position risk was verified through the core only.
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
    await copyFile(path.join(ROOT, "branding", "daily_risk_panel-icon.png"), path.join(mediaDir, "icon2.png"));
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

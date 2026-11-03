// scripts/create-at24-prop-guard-listings.ts
// AT24 Prop Guard - MT5 (licensed non-trading utility EA that embeds the indicator) and TradingView (Pine risk-budget calculator), 11 USD each.
//   npx tsx scripts/create-at24-prop-guard-listings.ts            -> creates/updates the listings as DRAFT (not visible)
//   npx tsx scripts/create-at24-prop-guard-listings.ts --publish  -> also sets publicationState PUBLISHED
// MT5 tradingSystemId doubles as the licence gate's product id (AT24-PROP-GUARD). No MT4 edition: an MT4 EA cannot load the indicator.
// Claims rule: it is a display tool; it never closes trades; no prop firm is named and no breach/pass claim is made.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const PRICE_USD = 11; // set by the owner
const ROOT = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m18-at24-indicators");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const FOOT = `\n\nContext tool, not a guarantee. It does not prevent a breach and never closes, opens or modifies trades. Rules differ by firm and by account; set your own limits. Not connected to or affiliated with any prop firm. Not financial advice. Trading leveraged products is risky.`;

const LICENCE = `\n\nLICENCE KEY: the download is protected by your AT24 licence key. One key works on ONE trading account at a time and only for this product; you can move it to another account yourself (2 changes per 30 days) from Dashboard > Purchases. After buying, paste the key from your purchase page into the EA input "InpLicenseKey" and allow https://www.algotraders24.ai under Tools > Options > Expert Advisors > Allow WebRequest. The Strategy Tester needs no key.`;

type Product = { slug: string; title: string; tradingSystemId: string; version: string; platform: string; zip: string; banner: string; tags: string[]; description: string };

const PRODUCTS: Product[] = [
  {
    slug: "at24-prop-guard",
    title: "AT24 Prop Guard (MT5)",
    tradingSystemId: "AT24-PROP-GUARD",
    version: "1.01",
    platform: "MT5",
    zip: "AT24_PropGuard_MT5_v1.01.zip",
    banner: "prop-guard-banner.png",
    tags: ["indicator", "risk", "drawdown", "daily-loss", "dashboard", "account", "mt5"],
    description: `AT24 Prop Guard shows how much room you have left before your own loss limits, on one dashboard on your MetaTrader 5 chart.

What you get
- Status: WITHIN LIMITS / CAUTION (50%) / DANGER (80%) / LIMIT REACHED.
- Daily loss used (percent and money) and total loss used, each with a gauge; money left today and overall, and which limit is binding.
- Open risk if every stop loss is hit, and how many open trades have no stop.
- Profit-target progress, the day-start value and the reset hour you choose; optional alerts at 80% and 95% of a limit.
You type your own daily loss %, max loss %, target % and reset hour to match your account rules. It is a display: it never closes or modifies trades.

It is delivered as a non-trading utility Expert Advisor with the indicator built into the file (MT5 does not allow licence checks inside indicators): attach it to a chart and the dashboard appears.

What was verified: compiles with 0 errors and 0 warnings in the real MetaEditor; a self-test script on a live demo account passed 22 of 22 checks (synthetic scenarios for limits, breach, profit, total loss, target progress, status levels and a 17:00 reset, plus the indicator values against an independent calculation); runs on a real MT5 chart (see the screenshot, demo account).
Not verified: open risk with real open positions (the test accounts had no open trades, so only the zero-position case was compared - treat that line as unverified with live trades); the day start "balance at reset" is rebuilt from deal history and "equity when first seen" depends on when you first attached it that day; alerts on a live feed; the licence check with a real purchase. MetaTrader 5 only; a MetaTrader 4 edition is not included.${FOOT}${LICENCE}`,
  },
  {
    slug: "at24-prop-guard-tradingview",
    title: "AT24 Prop Guard (TradingView)",
    tradingSystemId: "AT24-PROP-GUARD-TV",
    version: "1.00",
    platform: "TradingView",
    zip: "AT24_PropGuard_TradingView_v1.00.zip",
    banner: "prop-guard-tv-banner.png",
    tags: ["indicator", "risk", "position-size", "calculator", "drawdown", "dashboard", "tradingview", "pine"],
    description: `AT24 Prop Guard for TradingView is a risk-budget calculator: you type your account size, daily and max loss limits and the loss already used, and it shows what is left and what one trade can risk.

TradingView cannot read your trading account, so this edition works only from the numbers you enter. You get the limits left in money, risk per trade in money, how many full losses fit before the limit, the stop distance (ATR-based or manual) and the position size for that risk, with stop-distance lines on the chart. The position size is a calculation from your inputs, not advice on how large to trade.

What was verified: the script compiles and renders in TradingView's Pine Editor (XAUUSD 1h, see the screenshot); sample numbers checked by hand (100,000 account, 5% daily limit = 5,000, 0.5% risk = 500, 10 full losses to the limit).
Not verified: live-money use, other symbols and exchanges. Delivered as a zip with the Pine source and a one-minute install guide. Plain Pine source with no web access: TradingView cannot check a licence key inside a script, so the licence is the purchase itself - the file is delivered to your AT24 account for use on your own TradingView account, please do not share or publish it.${FOOT}`,
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
    await copyFile(path.join(ROOT, "branding", "prop_guard-icon.png"), path.join(mediaDir, "icon2.png"));
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

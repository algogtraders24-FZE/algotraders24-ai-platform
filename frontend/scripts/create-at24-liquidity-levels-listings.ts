// scripts/create-at24-liquidity-levels-listings.ts
// AT24 Liquidity Levels - MT5 (licensed non-trading utility EA that embeds the indicator) and TradingView (Pine source), 11 USD each.
//   npx tsx scripts/create-at24-liquidity-levels-listings.ts            -> creates/updates the listings as DRAFT (not visible)
//   npx tsx scripts/create-at24-liquidity-levels-listings.ts --publish  -> also sets publicationState PUBLISHED
// MT5 tradingSystemId doubles as the licence gate's product id (AT24-LIQUIDITY-LEVELS).
// Claims rule: descriptive history only; no "reversal after a sweep works", no win rate, no edge.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const PRICE_USD = 11; // set by the owner
const ROOT = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m18-at24-indicators");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const FOOT = `\n\nDescriptive history on your own broker data. Context tool, not a signal or a forecast; it never prints buy or sell arrows and never places orders. Not financial advice. Trading leveraged products is risky.`;

const LICENCE = `\n\nLICENCE KEY: the download is protected by your AT24 licence key. One key works on ONE trading account at a time and only for this product; you can move it to another account yourself (2 changes per 30 days) from Dashboard > Purchases. After buying, paste the key from your purchase page into the EA input "InpLicenseKey" and allow https://www.algotraders24.ai under Tools > Options > Expert Advisors > Allow WebRequest. The Strategy Tester needs no key.`;

const RESULT = `Real result on one broker feed (XAUUSD M15, last 60 GMT days, 53 days with a previous-day level): the previous-day high was swept about 41-42% of the time, the low about 57%, either about 77% and both about 21%. After a sweep the day closed back inside about 58-60% and accepted beyond about 40-42% - but that is only 52 sweeps, so the uncertainty is wide. It is descriptive and not an edge: our earlier scan of 25 entry rules, which included a previous-day sweep rule, found no cost-adjusted edge.`;

type Product = { slug: string; title: string; tradingSystemId: string; version: string; platform: string; zip: string; banner: string; tags: string[]; description: string };

const PRODUCTS: Product[] = [
  {
    slug: "at24-liquidity-levels",
    title: "AT24 Liquidity Levels (MT5)",
    tradingSystemId: "AT24-LIQUIDITY-LEVELS",
    version: "1.01",
    platform: "MT5",
    zip: "AT24_LiquidityLevels_MT5_v1.01.zip",
    banner: "liquidity-levels-banner.png",
    tags: ["indicator", "liquidity", "previous-day-high-low", "sweep", "levels", "statistics", "dashboard", "gold", "xauusd", "mt5"],
    description: `Everyone talks about "liquidity above yesterday's high", but nobody shows how often a level is really swept and what the day did next. AT24 Liquidity Levels draws the previous day, week and month high and low on your chart and measures what happened on your own symbol.

What you get
- Six level lines (previous day, week and month high and low) with a live state label: untouched, swept (price traded beyond) or accepted (a bar closed beyond), and the distance from price to each.
- Statistics for the last 60 days on your own data: how often the previous-day high and low were swept, and after a sweep how often the day closed back inside versus accepted beyond.
- Optional alert when a day level is swept (bar close, no repaint). Day boundaries in GMT with an automatic broker-clock offset.

It is delivered as a non-trading utility Expert Advisor with the indicator built into the file (MT5 does not allow licence checks inside indicators): attach it to a chart (M5 to H4) and the levels and dashboard appear.

What was verified: compiles with 0 errors and 0 warnings in the real MetaEditor and runs on a real MT5 XAUUSD M15 chart (see the screenshot). The maths match an independent Python calculation (89 day, week and month periods, 0 mismatches; the test also found and fixed a window-boundary bug).
${RESULT}
Not verified: live-money use, alerts and live ticking of the states beyond a screenshot, the licence check with a real purchase. The server-to-GMT conversion uses the current offset, so days from the other side of a daylight-saving change can be one hour off. MetaTrader 5 only; MT4 and TradingView editions are listed separately where available.${FOOT}${LICENCE}`,
  },
  {
    slug: "at24-liquidity-levels-tradingview",
    title: "AT24 Liquidity Levels (TradingView)",
    tradingSystemId: "AT24-LIQUIDITY-LEVELS-TV",
    version: "1.00",
    platform: "TradingView",
    zip: "AT24_LiquidityLevels_TradingView_v1.00.zip",
    banner: "liquidity-levels-tv-banner.png",
    tags: ["indicator", "liquidity", "previous-day-high-low", "sweep", "levels", "statistics", "dashboard", "gold", "tradingview", "pine"],
    description: `AT24 Liquidity Levels for TradingView draws the previous day, week and month high and low on your chart and shows how often the previous-day levels were swept over the last 60 days, with a dashboard table (Pine Script).

What you get
- The levels as lines with their state (untouched, swept, accepted), a dashboard with the sweep statistics, and what the day did after a sweep.
- Day, week and month boundaries follow the symbol's exchange session (for example 17:00 New York on OANDA), so the numbers differ slightly from the MetaTrader 5 edition, which uses GMT days.

What was verified: the script compiles and renders in TradingView's Pine Editor (OANDA XAUUSD 1h, 60 days: previous-day high swept 43%, low 60%, either 90%; back inside after a sweep 58% - see the screenshot). These numbers are historical and descriptive and show no edge.
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
    await copyFile(path.join(ROOT, "branding", "liquidity_levels-icon.png"), path.join(mediaDir, "icon2.png"));
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

// scripts/create-at24-spread-guard-listings.ts
// AT24 Spread Guard - MT5 (licensed non-trading utility EA that embeds the indicator) and TradingView (Pine source), 11 USD each.
//   npx tsx scripts/create-at24-spread-guard-listings.ts            -> creates/updates the listings as DRAFT (not visible)
//   npx tsx scripts/create-at24-spread-guard-listings.ts --publish  -> also sets publicationState PUBLISHED
// MT5 tradingSystemId doubles as the licence gate's product id (AT24-SPREAD-GUARD). No MT4 edition: an MT4 EA cannot load the indicator.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const PRICE_USD = 11; // set by the owner
const ROOT = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m18-at24-indicators");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const FOOT = `\n\nCost tool. Not a signal. It does not say when to trade, and trading in cheap hours does not make money by itself. Past conditions do not predict future results. Not financial advice. It never places orders. Trading leveraged products is risky.`;

const LICENCE = `\n\nLICENCE KEY: the download is protected by your AT24 licence key. One key works on ONE trading account at a time and only for this product; you can move it to another account yourself (2 changes per 30 days) from Dashboard > Purchases. After buying, paste the key from your purchase page into the EA input "InpLicenseKey" and allow https://www.algotraders24.ai under Tools > Options > Expert Advisors > Allow WebRequest. The Strategy Tester needs no key.`;

type Product = { slug: string; title: string; tradingSystemId: string; version: string; platform: string; zip: string; banner: string; tags: string[]; description: string };

const PRODUCTS: Product[] = [
  {
    slug: "at24-spread-guard",
    title: "AT24 Spread Guard (MT5)",
    tradingSystemId: "AT24-SPREAD-GUARD",
    version: "1.01",
    platform: "MT5",
    zip: "AT24_SpreadGuard_MT5_v1.01.zip",
    banner: "spread-guard-banner.png",
    tags: ["indicator", "spread", "cost", "hourly", "scalping", "atr", "dashboard", "gold", "mt5"],
    description: `AT24 Spread Guard shows what trading costs you right now compared with what is usual for this hour, on one dashboard and one sub-window.

What you get
- Live spread now against the typical spread for this GMT hour, status NORMAL / ELEVATED / SPIKE.
- Spread as a share of ATR(14) with a HIGH COST warning.
- The 3 cheapest and 3 costliest hours (GMT) and a 24-hour mini chart of the hourly profile; a coloured spread histogram with the typical-hour line; an optional alert when the spread spikes.
- The profile is learned from YOUR broker, from the spread stored on the bars or, when that history is flat, from the live spread over time. The panel says which source it uses and says "learning" while the live profile fills.

It is delivered as a non-trading utility Expert Advisor with the indicator built into the file (MT5 does not allow licence checks inside indicators): attach it to a chart and the indicator window opens below the chart.

What was verified: compiles with 0 errors and 0 warnings in the real MetaEditor and runs on a real MT5 XAUUSD M15 chart (see the screenshot). The hourly profile matches an independent Python calculation on 6,000 XAUUSD M15 bars (mean per hour differs by at most 4e-7). Real finding: on some brokers (for example an IC Markets Raw demo feed) the spread stored on historical bars is the same at every hour, so a history-only profile tells you nothing - that is why the live-learning profile exists. If your broker stores no bar spreads the histogram stays empty and the panel relies on the live profile. Gold fact from our own research: with about 30 points of cost, M1 gold gives away about half the risk unit to costs and M5 about a quarter.
Not verified: live-money use, alerts on a live feed, the daylight-saving boundary (bars from the other half of a daylight-saving year can be off by one hour), the licence check with a real purchase. MetaTrader 5 only; a MetaTrader 4 edition is not included.${FOOT}${LICENCE}`,
  },
  {
    slug: "at24-spread-guard-tradingview",
    title: "AT24 Spread Guard (TradingView)",
    tradingSystemId: "AT24-SPREAD-GUARD-TV",
    version: "1.00",
    platform: "TradingView",
    zip: "AT24_SpreadGuard_TradingView_v1.00.zip",
    banner: "spread-guard-tv-banner.png",
    tags: ["indicator", "spread", "cost", "hourly", "range", "dashboard", "gold", "tradingview", "pine"],
    description: `AT24 Spread Guard for TradingView is a cost-context dashboard: which hours of the day are cheapest and costliest to trade, and what this hour costs.

TradingView has no historical spread data, so this edition works from the average bar RANGE per UTC hour plus the typical spread you type in the inputs. You get this hour's estimated cost, spread against average range, the cheapest and costliest hours (UTC) and a histogram. It is a cost estimate, not a measurement of your broker's real spread; for the real spread use the MetaTrader 5 edition.

What was verified: the script compiles and renders in TradingView's Pine Editor (XAUUSD 1h, see the screenshot).
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
    await copyFile(path.join(ROOT, "branding", "spread_guard-icon.png"), path.join(mediaDir, "icon2.png"));
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

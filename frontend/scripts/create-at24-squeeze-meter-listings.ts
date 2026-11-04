// scripts/create-at24-squeeze-meter-listings.ts
// AT24 Squeeze Meter - MT5 (licensed non-trading utility EA that embeds the indicator) and TradingView (Pine source), 11 USD each.
//   npx tsx scripts/create-at24-squeeze-meter-listings.ts            -> creates/updates the listings as DRAFT (not visible)
//   npx tsx scripts/create-at24-squeeze-meter-listings.ts --publish  -> also sets publicationState PUBLISHED
// MT5 tradingSystemId doubles as the licence gate's product id (AT24-SQUEEZE-METER).
// Claims rule: descriptive history only; no "squeeze breakout strategy", no win rate, no edge (a squeeze did not precede a bigger move).
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const PRICE_USD = 11; // set by the owner
const ROOT = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m18-at24-indicators");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const FOOT = `\n\nDescriptive history on your own broker data. Context tool, not a signal or a forecast; it prints no buy or sell arrows and never places orders. Not financial advice. Trading leveraged products is risky.`;

const LICENCE = `\n\nLICENCE KEY: the download is protected by your AT24 licence key. One key works on ONE trading account at a time and only for this product; you can move it to another account yourself (2 changes per 30 days) from Dashboard > Purchases. After buying, paste the key from your purchase page into the EA input "InpLicenseKey" and allow https://www.algotraders24.ai under Tools > Options > Expert Advisors > Allow WebRequest. The Strategy Tester needs no key.`;

const RESULT = `Real result on one broker feed (XAUUSD M15, last 8,000 closed bars, 132 squeezes of at least 6 bars): the 20 bars after a squeeze released had a median range of about 4.5 ATR against about 4.6 ATR after any bar, were wider than usual after about 46% of releases, and the momentum sign matched the bigger side about 52% of the time - a coin flip. On this data a squeeze did NOT precede a bigger move. This is descriptive, depends on the definitions shown on the dashboard, and is not an edge.`;

type Product = { slug: string; title: string; tradingSystemId: string; version: string; platform: string; zip: string; banner: string; tags: string[]; description: string };

const PRODUCTS: Product[] = [
  {
    slug: "at24-squeeze-meter",
    title: "AT24 Squeeze Meter (MT5)",
    tradingSystemId: "AT24-SQUEEZE-METER",
    version: "1.01",
    platform: "MT5",
    zip: "AT24_SqueezeMeter_MT5_v1.01.zip",
    banner: "squeeze-meter-banner.png",
    tags: ["indicator", "squeeze", "bollinger", "keltner", "momentum", "volatility", "statistics", "dashboard", "gold", "xauusd", "mt5"],
    description: `"A squeeze always leads to a big move" is repeated everywhere, but few traders have seen what squeezes really did on their own symbol. AT24 Squeeze Meter detects the Bollinger-inside-Keltner squeeze, shows the momentum, and measures what happened after past squeezes released.

What you get
- A sub-window with squeeze dots on the zero line (red = squeeze on) and a momentum histogram (lighter = rising, darker = fading).
- State on the dashboard: SQUEEZE ON (how many bars), RELEASED n bars ago, or NO SQUEEZE, with momentum direction and the band ratio.
- Real history on your own data: how many squeezes of a minimum length happened in the last 8,000 bars, their median length, the range of the next 20 bars against the range after any bar, how often it was wider than usual and how often the momentum sign matched the bigger side. Optional alert on a release (bar close, no repaint).

It is delivered as a non-trading utility Expert Advisor with the indicator built into the file (MT5 does not allow licence checks inside indicators): attach it to a chart and the sub-window and dashboard appear.

What was verified: compiles with 0 errors and 0 warnings in the real MetaEditor and runs on a real MT5 XAUUSD M15 chart (see the screenshot). The maths match an independent Python calculation (squeeze state and momentum, all 137 releases identical).
${RESULT}
Not verified: live-money use, alerts beyond a screenshot, the licence check with a real purchase. MetaTrader 5 only; the TradingView edition is listed separately.${FOOT}${LICENCE}`,
  },
  {
    slug: "at24-squeeze-meter-tradingview",
    title: "AT24 Squeeze Meter (TradingView)",
    tradingSystemId: "AT24-SQUEEZE-METER-TV",
    version: "1.00",
    platform: "TradingView",
    zip: "AT24_SqueezeMeter_TradingView_v1.00.zip",
    banner: "squeeze-meter-tv-banner.png",
    tags: ["indicator", "squeeze", "bollinger", "keltner", "momentum", "volatility", "statistics", "dashboard", "gold", "tradingview", "pine"],
    description: `AT24 Squeeze Meter for TradingView shows the Bollinger-inside-Keltner squeeze and momentum in its own pane, plus a dashboard that measures what price really did after past squeezes released on the chart you are looking at (Pine Script).

What you get
- Squeeze dots on the zero line (red = on) and a momentum histogram, a state line (squeeze on / released / none), the band ratio, and an alert condition for a release.
- A dashboard table: squeezes measured and their median length, the range of the next 20 bars in ATR against the usual range, how often it was wider than usual and how often the momentum sign matched the bigger side.
- TradingView uses all the bars loaded on your chart, so counts differ from the MetaTrader 5 edition by timeframe and history.

What was verified: the script compiles and renders in TradingView's Pine Editor (OANDA XAUUSD 1h, 171 squeezes measured: next 20 bars range 4.4 ATR vs 4.5 ATR usual, wider than usual 47%, momentum matched the bigger side 50% - see the screenshot). These numbers are historical and descriptive and show no edge: a squeeze did not precede a bigger move.
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
    await copyFile(path.join(ROOT, "branding", "squeeze_meter-icon.png"), path.join(mediaDir, "icon2.png"));
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

// scripts/create-at24-session-range-box-listings.ts
// AT24 Session Range Box - MT5 (licensed non-trading utility EA that embeds the indicator) and TradingView (Pine source), 11 USD each.
//   npx tsx scripts/create-at24-session-range-box-listings.ts            -> creates/updates the listings as DRAFT (not visible)
//   npx tsx scripts/create-at24-session-range-box-listings.ts --publish  -> also sets publicationState PUBLISHED
// MT5 tradingSystemId doubles as the licence gate's product id (AT24-SESSION-RANGE-BOX).
// Claims rule: descriptive history only; no "breakout strategy that works", no win rate, no edge.
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

const RESULT = `Real result on one broker feed (XAUUSD M15, last 60 GMT days, Asia 00:00-07:00 GMT, watching to 21:00): the first break was up about 40-43% of the time, down about 50-52% and none about 7%; when it broke, it held to the day end about 51% of the time - about a coin flip - and ran at least 1x the box about 33%. These numbers are historical and descriptive, differ by broker and period, and show no edge (our earlier scan of 25 entry rules found no cost-adjusted edge either).`;

type Product = { slug: string; title: string; tradingSystemId: string; version: string; platform: string; zip: string; banner: string; tags: string[]; description: string };

const PRODUCTS: Product[] = [
  {
    slug: "at24-session-range-box",
    title: "AT24 Session Range Box (MT5)",
    tradingSystemId: "AT24-SESSION-RANGE-BOX",
    version: "1.01",
    platform: "MT5",
    zip: "AT24_SessionRangeBox_MT5_v1.01.zip",
    banner: "session-range-box-banner.png",
    tags: ["indicator", "session", "asia", "range", "breakout", "statistics", "dashboard", "gold", "xauusd", "mt5"],
    description: `Traders hear "trade the Asian range breakout" but rarely see how it really behaved on THEIR broker and symbol. AT24 Session Range Box draws the Asian range every day and measures what the first break did over the last 60 days.

What you get
- The Asia session range as a box on your chart every day, with a dotted extension box coloured by state: inside, broke up, broke down, no break yet.
- Live state, today's box size against the median box, and a countdown to the London open.
- Real history on your own data: how often the first break was up, down or none, how often a break held to the day end, how often it ran at least 1x the box.
- Optional alert on the first break (bar close, no repaint). Session hours in GMT with an automatic broker-clock offset.

It is delivered as a non-trading utility Expert Advisor with the indicator built into the file (MT5 does not allow licence checks inside indicators): attach it to a chart and the boxes and dashboard appear.

What was verified: compiles with 0 errors and 0 warnings in the real MetaEditor and runs on a real MT5 XAUUSD M15 chart (see the screenshot). The box and break maths match an independent Python calculation (43 days compared, 0 mismatches; the statistics were identical).
${RESULT}
Not verified: live-money use, alerts on a live running chart, the licence check with a real purchase. The server-to-GMT conversion uses the current offset, so days from the other side of a daylight-saving change can be one hour off. MetaTrader 5 only; MT4 and TradingView editions are listed separately where available.${FOOT}${LICENCE}`,
  },
  {
    slug: "at24-session-range-box-tradingview",
    title: "AT24 Session Range Box (TradingView)",
    tradingSystemId: "AT24-SESSION-RANGE-BOX-TV",
    version: "1.00",
    platform: "TradingView",
    zip: "AT24_SessionRangeBox_TradingView_v1.00.zip",
    banner: "session-range-box-tv-banner.png",
    tags: ["indicator", "session", "asia", "range", "breakout", "statistics", "dashboard", "gold", "tradingview", "pine"],
    description: `AT24 Session Range Box for TradingView draws the Asian range every day and shows what the first break did over the last 60 days, with a dashboard table (Pine Script).

What you get
- The Asia range as a box every day, coloured by state (inside, broke up, broke down), box size against the median, and the days analysed.
- How the first break went (up / down / none), how often a break held to the day end and how often it ran at least 1x the box. Hours are in GMT/UTC and the statistics use the history your TradingView plan loads.

What was verified: the script compiles and renders in TradingView's Pine Editor (OANDA XAUUSD 1h, 60 days: first break up 40%, down 48%, none 12%; held 60% of broken days; ran 1x on 36% - see the screenshot). These numbers are historical and descriptive, differ by feed and period, and show no edge.
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
    await copyFile(path.join(ROOT, "branding", "session_range_box-icon.png"), path.join(mediaDir, "icon2.png"));
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

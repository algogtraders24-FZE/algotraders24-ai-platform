// scripts/create-at24-news-risk-clock-listings.ts
// AT24 News Risk Clock - MT5 (licensed non-trading utility EA that embeds the indicator), 11 USD.
//   npx tsx scripts/create-at24-news-risk-clock-listings.ts            -> creates/updates the listings as DRAFT (not visible)
//   npx tsx scripts/create-at24-news-risk-clock-listings.ts --publish  -> also sets publicationState PUBLISHED
// MT5 tradingSystemId doubles as the licence gate's product id (AT24-NEWS-RISK-CLOCK).
// Claims rule: descriptive history only; the statistic is the SIZE of the move after news, never its direction; no "trade the news" edge, no win rate; calendar data come from the terminal and can be late or revised.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const PRICE_USD = 11; // set by the owner
const ROOT = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m18-at24-indicators");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const FOOT = `\n\nDescriptive history on your own broker data. Context tool, not a signal or a forecast; it prints no buy or sell arrows and never places orders; it reads the terminal's built-in economic calendar (late or revised data are possible, it is not a guarantee that no news is missed) and does nothing in the Strategy Tester. Not financial advice. Trading leveraged products is risky.`;

const LICENCE = `\n\nLICENCE KEY: the download is protected by your AT24 licence key. One key works on ONE trading account at a time and only for this product; you can move it to another account yourself (2 changes per 30 days) from Dashboard > Purchases. After buying, paste the key from your purchase page into the EA input "InpLicenseKey" and allow https://www.algotraders24.ai under Tools > Options > Expert Advisors > Allow WebRequest. The Strategy Tester needs no key.`;

const RESULT = `Real result - it depends on the broker feed. On our IC Markets demo feed (XAUUSD M15, last 85 days, 163 high-impact USD events) the typical event gave about 0.98x the quiet-day range at the same clock time (median 11.65 vs 9.82); about 23% of events gave at least 1.5x, about 10% at least 2x, and 55% were quieter than a normal quiet-day window. On another broker feed (Equiti, 159 events) the same measure gave a median of about 1.41x with 47% at least 1.5x. So the effect on the gold range was not consistent between feeds - run it on your own broker data. It measures the SIZE of the move, never its direction, and is not an edge.`;

type Product = { slug: string; title: string; tradingSystemId: string; version: string; platform: string; zip: string; banner: string; tags: string[]; description: string };

const PRODUCTS: Product[] = [
  {
    slug: "at24-news-risk-clock",
    title: "AT24 News Risk Clock (MT5)",
    tradingSystemId: "AT24-NEWS-RISK-CLOCK",
    version: "1.01",
    platform: "MT5",
    zip: "AT24_NewsRiskClock_MT5_v1.01.zip",
    banner: "news-risk-clock-banner.png",
    tags: ["indicator", "news", "economic-calendar", "countdown", "volatility", "high-impact", "statistics", "dashboard", "gold", "xauusd", "mt5", "demo-tested"],
    description: `Traders get caught holding positions through high-impact news. AT24 News Risk Clock reads MetaTrader's own economic calendar, counts down to the next high-impact events, shows a risk-window state and the event lines on your chart, and measures on your own symbol how big the price range really was after such news compared with quiet days.

What you get
- A countdown to the next high-impact events (USD by default, any currencies you list) and event lines on the chart.
- A state: CLEAR / NEWS SOON / RISK WINDOW / JUST RELEASED.
- Real history on your own data: the 30-minute range after news against the same clock time on quiet days, how often it was at least 1.5x and 2x bigger, and how often it was quieter. Optional alerts.
- No extra accounts or web requests: it uses the terminal's built-in calendar. It needs a live, connected terminal and does nothing in the Strategy Tester. Calendar data come from MetaQuotes and can be late or revised.

It is delivered as a non-trading utility Expert Advisor with the indicator built into the file (MT5 does not allow licence checks inside indicators): attach it to a chart and the countdown and dashboard appear.

What was verified: compiles with 0 errors and 0 warnings in the real MetaEditor and runs on a real MT5 XAUUSD M15 chart with a live calendar (see the screenshot). The per-event ratios and statistics match an independent Python calculation (all 159 events identical).
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
    await copyFile(path.join(ROOT, "branding", "news_risk_clock-icon.png"), path.join(mediaDir, "icon2.png"));
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

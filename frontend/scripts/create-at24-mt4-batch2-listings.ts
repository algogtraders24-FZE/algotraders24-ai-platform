// scripts/create-at24-mt4-batch2-listings.ts
// AT24 education tools for MetaTrader 4 (licensed non-trading utility EAs), 11 USD each. Usage:
//   npx tsx scripts/create-at24-mt4-batch2-listings.ts            -> creates/updates the listings as DRAFT (not visible)
//   npx tsx scripts/create-at24-mt4-batch2-listings.ts --publish  -> also sets publicationState PUBLISHED
//
// MT4 does not allow WebRequest inside indicators, so each product is an Expert Advisor that only draws.
// It carries the standard AT24 licence gate: tradingSystemId doubles as the gate's product id
// (AT24-PIVOT-LEVELS-MAP-MT4 / AT24-HOURLY-RANGE-HEATMAP-MT4), so an MT5 key never opens an MT4 build.
// No Trust State; the descriptions state what was and was not verified.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const PRICE_USD = 22; // set by the owner
const ROOT = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m18-at24-indicators");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const FOOTER = `\n\nEducation tool, not a signal: it draws levels and shows context, it never places orders and gives no buy or sell advice. It uses no DLL. Personal use on your own charts. Past averages and past price behaviour do not predict future price. Trading leveraged products is risky.\n\nLICENCE KEY: the download is protected by your AT24 licence key. One key works on ONE trading account at a time and only for this product; you can move it to another account yourself (2 changes per 30 days) from Dashboard > Purchases. After buying, paste the key from your purchase page into the EA input "InpLicenseKey" and allow https://www.algotraders24.ai under Tools > Options > Expert Advisors > Allow WebRequest. The Strategy Tester needs no key.`;

type Product = { slug: string; title: string; tradingSystemId: string; version: string; zip: string; icon: string; banner: string; tags: string[]; description: string };

const PRODUCTS: Product[] = [
  {
    "slug": "at24-weekend-gap-tracker-mt4",
    "title": "AT24 Weekend Gap Tracker (MT4)",
    "tradingSystemId": "AT24-WEEKEND-GAP-TRACKER-MT4",
    "version": "1.00",
    "zip": "AT24_WeekendGapTracker_MT4_v1.00.zip",
    "icon": "weekend_gap_tracker-icon.png",
    "banner": "weekend-gap-tracker-mt4-banner.png",
    "tags": [
      "indicator",
      "weekend-gap",
      "gap",
      "gap-fill",
      "statistics",
      "dashboard",
      "gold",
      "mt4",
      "demo-tested"
    ],
    "description": "'The weekend gap always fills' is repeated everywhere and rarely checked. AT24 Weekend Gap Tracker for MetaTrader 4 marks the latest market-closed gap, shows whether it has been filled, and measures on your own symbol how often gaps really filled - next to a control level at the same distance on the other side.\n\nWhat you get\n- The latest gap as a zone and a line on your chart: size in price and in ATR, direction, when the market reopened and whether the old close has been reached again.\n- A dashboard: gaps measured, share of up gaps, typical size in ATR, and how often a gap filled within 1 hour, 4 hours, 24 hours and 5 days, each beside the control level.\n- Closed bars only, so nothing repaints.\n\nWhat was verified: compiles with 0 errors and 0 warnings in MetaEditor 4 and runs on an MT4 demo terminal on XAUUSD H1 (152 gaps of at least 0.1 ATR: filled within 4 hours 65% against 72% for the control level, within 24 hours 81% against 87%, within 5 days 89% against 93% - see the screenshot). These numbers are historical and descriptive and show no edge: a gap is no stronger a magnet than any other level at that distance.\nNot verified: live-money use, other symbols and brokers, the licence check with a real purchase on MT4. It is delivered as a non-trading utility Expert Advisor (MT4 does not allow licence checks inside indicators). MetaTrader 4 only.\n\nEducation tool, not a signal: it draws levels and shows context, it never places orders and gives no buy or sell advice. It uses no DLL. Personal use on your own charts. Past averages and past price behaviour do not predict the future."
  },
  {
    "slug": "at24-streak-meter-mt4",
    "title": "AT24 Streak Meter (MT4)",
    "tradingSystemId": "AT24-STREAK-METER-MT4",
    "version": "1.00",
    "zip": "AT24_StreakMeter_MT4_v1.00.zip",
    "icon": "streak_meter-icon.png",
    "banner": "streak-meter-mt4-banner.png",
    "tags": [
      "indicator",
      "streak",
      "candles",
      "consecutive",
      "statistics",
      "dashboard",
      "gold",
      "mt4",
      "demo-tested"
    ],
    "description": "'After N down candles a reversal is due' (or 'the streak will continue') is repeated everywhere and rarely checked. AT24 Streak Meter for MetaTrader 4 counts the current same-colour candle streak on the timeframe you choose (daily by default) and shows, on your own symbol, how often the next candle had the same colour after streaks of 1, 2, 3, 4, 5 and 6+ candles - with the sample sizes, 95% intervals and the any-candle baseline.\n\nWhat you get\n- The current streak (for example 3 D1 candles down in a row).\n- A table of how often the next candle continued the streak, by streak length, with n and a 95% interval, next to the baseline.\n- Honest about small samples: long streaks have few cases, so their percentages carry wide intervals.\n\nWhat was verified: compiles with 0 errors and 0 warnings in MetaEditor 4 and runs on an MT4 demo terminal on XAUUSD (3,000 daily candles: the next candle had the same colour as the last 46.2% of the time; after streaks of 1 to 6+ candles it stayed between 42% and 51% - see the screenshot). These numbers are historical and descriptive and show no edge: a streak is not 'due' to reverse or to continue.\nNot verified: live-money use, other symbols and brokers, the licence check with a real purchase on MT4. It is delivered as a non-trading utility Expert Advisor (MT4 does not allow licence checks inside indicators). MetaTrader 4 only.\n\nEducation tool, not a signal: it draws levels and shows context, it never places orders and gives no buy or sell advice. It uses no DLL. Personal use on your own charts. Past averages and past price behaviour do not predict the future."
  },
  {
    "slug": "at24-candle-pattern-lab-mt4",
    "title": "AT24 Candle Pattern Lab (MT4)",
    "tradingSystemId": "AT24-CANDLE-PATTERN-LAB-MT4",
    "version": "1.00",
    "zip": "AT24_CandlePatternLab_MT4_v1.00.zip",
    "icon": "candle_pattern_lab-icon.png",
    "banner": "candle-pattern-lab-mt4-banner.png",
    "tags": [
      "indicator",
      "candlestick",
      "engulfing",
      "pin-bar",
      "patterns",
      "statistics",
      "dashboard",
      "gold",
      "mt4",
      "demo-tested"
    ],
    "description": "'A bullish engulfing candle means price goes up' is repeated everywhere and rarely checked. AT24 Candle Pattern Lab for MetaTrader 4 marks engulfing candles and pin bars on closed bars and measures on your own symbol what price really did after them, compared with any bar.\n\nWhat you get\n- Bullish and bearish engulfing candles and pin bars marked on your chart; small candles below an ATR size you choose are ignored as noise.\n- A dashboard: what the last closed candle is, and for each pattern the number of cases and how often price moved the pattern's way over the next 6 bars, with a 95% interval, beside the rate for any bar.\n- Closed bars only, so nothing repaints.\n\nWhat was verified: compiles with 0 errors and 0 warnings in MetaEditor 4 and runs on an MT4 demo terminal on XAUUSD H1 (last 8,000 bars: after 6 bars bullish engulfing moved up 51% of the time against 52% for any bar, bearish engulfing down 51% against 48%, bullish pin bar up 51% against 52%, bearish pin bar down 46% against 48% - see the screenshot). These numbers are historical and descriptive and show no edge: the patterns sit within noise of the baseline.\nNot verified: live-money use, other symbols and brokers, the licence check with a real purchase on MT4. It is delivered as a non-trading utility Expert Advisor (MT4 does not allow licence checks inside indicators). MetaTrader 4 only.\n\nEducation tool, not a signal: it draws levels and shows context, it never places orders and gives no buy or sell advice. It uses no DLL. Personal use on your own charts. Past averages and past price behaviour do not predict the future."
  },
  {
    "slug": "at24-persistence-meter-mt4",
    "title": "AT24 Persistence Meter (MT4)",
    "tradingSystemId": "AT24-PERSISTENCE-METER-MT4",
    "version": "1.00",
    "zip": "AT24_PersistenceMeter_MT4_v1.00.zip",
    "icon": "persistence_meter-icon.png",
    "banner": "persistence-meter-mt4-banner.png",
    "tags": [
      "indicator",
      "variance-ratio",
      "trend",
      "mean-reversion",
      "random-walk",
      "statistics",
      "dashboard",
      "gold",
      "mt4",
      "demo-tested"
    ],
    "description": "'The market is trending' and 'the market is range-bound' are usually judged by eye. AT24 Persistence Meter for MetaTrader 4 measures it: the variance ratio of price moves over three horizons on your own symbol, a z-statistic against chance, and a study of whether the reading really said anything about what the next move did.\n\nWhat you get\n- VR, z and the implied exponent for three move lengths, and a state for the main one: moves tend to continue, tend to reverse, or look like a random walk.\n- A study over the loaded history: how much of the time each state occurred, and how often the next move went the same way as the last move - any time, when trending and when reverting - with sample sizes and 95% intervals.\n- Closed bars only; works on any timeframe.\n\nWhat was verified: compiles with 0 errors and 0 warnings in MetaEditor 4 and runs on an MT4 demo terminal on XAUUSD H1 (the state was a random walk with VR 0.83 at 8 bars; over 236 study windows the next move went the same way as the last 44% of the time, 46% when trending (n=13) and 54% when reverting (n=13) - see the screenshot). These numbers are historical and descriptive and show no edge: the trending and reverting samples are small and sit within noise of 'any time'.\nNot verified: live-money use, other symbols and brokers, the licence check with a real purchase on MT4. It is delivered as a non-trading utility Expert Advisor (MT4 does not allow licence checks inside indicators). MetaTrader 4 only.\n\nEducation tool, not a signal: it draws levels and shows context, it never places orders and gives no buy or sell advice. It uses no DLL. Personal use on your own charts. Past averages and past price behaviour do not predict the future."
  },
  {
    "slug": "at24-volume-profile-levels-mt4",
    "title": "AT24 Volume Profile Levels (MT4)",
    "tradingSystemId": "AT24-VOLUME-PROFILE-LEVELS-MT4",
    "version": "1.00",
    "zip": "AT24_VolumeProfileLevels_MT4_v1.00.zip",
    "icon": "volume_profile_levels-icon.png",
    "banner": "volume-profile-levels-mt4-banner.png",
    "tags": [
      "indicator",
      "volume-profile",
      "poc",
      "value-area",
      "levels",
      "statistics",
      "dashboard",
      "gold",
      "mt4",
      "demo-tested"
    ],
    "description": "'Price is drawn to yesterday's point of control' and 'the value area edges hold' are repeated everywhere and rarely checked. AT24 Volume Profile Levels for MetaTrader 4 draws yesterday's volume-profile levels from tick volume and measures on your own symbol how price really treated them - next to a control level mirrored through the day's open.\n\nWhat you get\n- Yesterday's POC and value area (VAH / VAL) on your chart, with the value area shaded and the levels extended into today.\n- A dashboard: whether price is inside, above or below yesterday's value area, its distance from the POC, and a study of how often price touched each level and how often it reacted away from it before breaking it - each beside the control level.\n- Tick volume from your broker feed, not exchange volume. Closed bars only.\n\nWhat was verified: compiles with 0 errors and 0 warnings in MetaEditor 4 and runs on an MT4 demo terminal on XAUUSD H1 (last 406 days: price touched yesterday's POC on 63% of days against 62% for the control level, VAH 61% against 60%, VAL 59% against 61%; after a touch it reacted away 46%, 49% and 54% against controls of 50%, 50% and 47% - see the screenshot). These numbers are historical and descriptive and show no edge: the levels behave like any other level at that distance.\nNot verified: live-money use, other symbols and brokers, the licence check with a real purchase on MT4. It is delivered as a non-trading utility Expert Advisor (MT4 does not allow licence checks inside indicators). MetaTrader 4 only.\n\nEducation tool, not a signal: it draws levels and shows context, it never places orders and gives no buy or sell advice. It uses no DLL. Personal use on your own charts. Past averages and past price behaviour do not predict the future."
  },
  {
    "slug": "at24-volatility-forecast-mt4",
    "title": "AT24 Volatility Forecast (MT4)",
    "tradingSystemId": "AT24-VOLATILITY-FORECAST-MT4",
    "version": "1.00",
    "zip": "AT24_VolatilityForecast_MT4_v1.00.zip",
    "icon": "volatility_forecast-icon.png",
    "banner": "volatility-forecast-mt4-banner.png",
    "tags": [
      "indicator",
      "volatility",
      "forecast",
      "ewma",
      "atr",
      "statistics",
      "dashboard",
      "gold",
      "mt4",
      "demo-tested"
    ],
    "description": "'Volatility is high' is usually judged by eye or by a single ATR number. AT24 Volatility Forecast for MetaTrader 4 estimates the expected size of the next move over the horizon you choose and then checks, on your own symbol, how well its past forecasts tracked the volatility that really followed.\n\nWhat you get\n- The expected 1-sigma and 2-sigma move over the next 8 hours (the horizon is an input), in price and in percent, as a band from the last close.\n- A volatility state - LOW / NORMAL / HIGH / VERY HIGH - from the percentile of the current level with the time-of-day pattern removed, and its size against the normal level.\n- A calibration table: correlation between the forecast and the volatility that followed, and the share of windows within +-30%, next to a plain average and an ATR(14)-only forecast.\n- Size of moves, NOT direction: it says nothing about where price will go. Closed bars only.\n\nWhat was verified: compiles with 0 errors and 0 warnings in MetaEditor 4 and runs on an MT4 demo terminal on XAUUSD H1 (974 windows of 8 hours: the forecast correlated 0.65 with the volatility that followed and 53% of windows landed within +-30%, against 0.61 / 49% for a plain average and 0.62 / 27% for ATR(14) alone - see the screenshot). These numbers are historical and descriptive; real tails are fatter than a normal band suggests, and there is no directional edge.\nNot verified: live-money use, other symbols and brokers, the licence check with a real purchase on MT4. It is delivered as a non-trading utility Expert Advisor (MT4 does not allow licence checks inside indicators). MetaTrader 4 only.\n\nEducation tool, not a signal: it draws levels and shows context, it never places orders and gives no buy or sell advice. It uses no DLL. Personal use on your own charts. Past averages and past price behaviour do not predict the future."
  }
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
      where: { tradingSystemId_versionId_platform_artifactHash: { tradingSystemId: p.tradingSystemId, versionId, platform: "MT4", artifactHash } },
      create: { tradingSystemId: p.tradingSystemId, versionId, platform: "MT4", artifactVersion: `v${p.version}`, artifactHash, releaseStatus: "PUBLISHED" },
      update: { releaseStatus: "PUBLISHED" },
    });
    await writeFile(path.join(RELEASES_DIR, `${release.id}.zip`), bytes);
    await writeFile(path.join(RELEASES_DIR, `${release.id}.filename.txt`), p.zip, "utf-8");

    const listing = await prisma.marketplaceListing.upsert({
      where: { slug: p.slug },
      create: {
        sellerId: seller.id, slug: p.slug, title: p.title, description: p.description,
        media: [], pricing: { model: "one_time", amount: PRICE_USD, currency: "USD" },
        category: "Utility", platformTag: "MT4", assetTag: "Gold", tags: p.tags,
        tradingSystemId: p.tradingSystemId, versionId,
        publicationState: "DRAFT",
      },
      update: { title: p.title, description: p.description, tags: p.tags, versionId, tradingSystemId: p.tradingSystemId, pricing: { model: "one_time", amount: PRICE_USD, currency: "USD" } },
    });

    const mediaDir = path.join(__dirname, "..", "public", "marketplace", listing.id);
    await mkdir(mediaDir, { recursive: true });
    await copyFile(path.join(ROOT, "branding", p.icon), path.join(mediaDir, "icon2.png"));
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

// scripts/create-at24-mt4-batch4-listings.ts
// AT24 education tools for MetaTrader 4 (licensed non-trading utility EAs), 11 USD each. Usage:
//   npx tsx scripts/create-at24-mt4-batch4-listings.ts            -> creates/updates the listings as DRAFT (not visible)
//   npx tsx scripts/create-at24-mt4-batch4-listings.ts --publish  -> also sets publicationState PUBLISHED
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
    "slug": "at24-hour-bias-map-mt4",
    "title": "AT24 Hour Bias Map (MT4)",
    "tradingSystemId": "AT24-HOUR-BIAS-MAP-MT4",
    "version": "1.00",
    "zip": "AT24_HourBiasMap_MT4_v1.00.zip",
    "icon": "hour_bias_map-icon.png",
    "banner": "hour-bias-map-mt4-banner.png",
    "tags": [
      "indicator",
      "hour-of-day",
      "seasonality",
      "intraday",
      "statistics",
      "dashboard",
      "gold",
      "mt4",
      "demo-tested"
    ],
    "description": "'Gold always rallies at this hour' is repeated everywhere and rarely checked. AT24 Hour Bias Map for MetaTrader 4 measures on your own symbol whether price direction really depends on the New York hour of the day - with t-statistics, a count of how many hours look significant against chance, and a split-half check of whether the pattern held.\n\nWhat you get\n- The mean return per New York hour in basis points as a 24-hour strip, with the current hour highlighted and significant hours marked.\n- A dashboard: the verdict for the current hour (no bias / weak bias / clear bias in the past data), its mean, t-statistic and share of up bars, and the two halves of the history side by side.\n- How many of the 24 hours show |t| of 1.96 or more (chance alone gives about 1) or 3 or more, and in how many hours both halves agree in sign.\n- The broker clock (server time and its daylight rule) is detected automatically, trying other FX pairs if the chart symbol cannot be used, and can be set by hand in the inputs. Dashboard is off in the Strategy Tester by default.\n\nWhat was verified: compiles with 0 errors and 0 warnings in MetaEditor 4 and runs on an MT4 Exness demo terminal on XAUUSD H1 (21,650 hourly bars: 2 of 24 hours had |t| of 1.96 or more, one had 3 or more, and 12 of 24 hours kept the same sign in both halves - see the screenshot). The broker clock was detected from EURUSD hourly data rebuilt from the demo's 15-minute history. These numbers are historical and descriptive and show no edge: most of the visible 'hour bias' is noise and the drift of the instrument.\nNot verified: live-money use, other symbols and brokers, the licence check with a real purchase on MT4. It is delivered as a non-trading utility Expert Advisor (MT4 does not allow licence checks inside indicators). MetaTrader 4 only.\n\nEducation tool, not a signal: it draws levels and shows context, it never places orders and gives no buy or sell advice. It uses no DLL. Personal use on your own charts. Past averages and past price behaviour do not predict the future."
  },
  {
    "slug": "at24-sweep-scorecard-mt4",
    "title": "AT24 Sweep Scorecard (MT4)",
    "tradingSystemId": "AT24-SWEEP-SCORECARD-MT4",
    "version": "1.00",
    "zip": "AT24_SweepScorecard_MT4_v1.00.zip",
    "icon": "sweep_scorecard-icon.png",
    "banner": "sweep-scorecard-mt4-banner.png",
    "tags": [
      "indicator",
      "asian-range",
      "liquidity-sweep",
      "session",
      "statistics",
      "research",
      "dashboard",
      "gold",
      "mt4",
      "demo-tested"
    ],
    "description": "'Trade the Asian range sweep' is one of the most repeated setups and rarely graded. AT24 Sweep Scorecard for MetaTrader 4 grades it on your own symbol: every sweep of the Asian-session range, scored in R after costs, the reversal trade next to the mirror trade and a random-direction control.\n\nWhat you get\n- A scorecard: number of sweeps, R per trade and hit rate for the reversal, the continuation and the control, the difference between reversal and control with its t-statistic, and the latest sweeps separately.\n- Today's state and the latest sweeps drawn on your chart: Asian box, sweep mark and the result of each.\n- A plain verdict by t-statistic. The losers are shown, not hidden. The rules of the graded trade are stated in the dashboard text; the tool places no trades.\n- The broker clock is detected automatically (other FX pairs are tried if the chart symbol cannot be used) and can be set by hand in the inputs. Dashboard is off in the Strategy Tester by default.\n\nWhat was verified: compiles with 0 errors and 0 warnings in MetaEditor 4 and runs on an MT4 Exness demo terminal on XAUUSD H1 (1,137 sweeps: reversal -0.25 R per trade against -0.21 R for the random-direction control, reversal minus control -0.04 R, and the setup lost money net of costs - see the screenshot). The broker clock was detected from EURUSD hourly data rebuilt from the demo's 15-minute history. This is descriptive history of a popular setup, not a signal, and shows no edge.\nNot verified: live-money use, other symbols and brokers, the licence check with a real purchase on MT4. It is delivered as a non-trading utility Expert Advisor (MT4 does not allow licence checks inside indicators). MetaTrader 4 only.\n\nEducation tool, not a signal: it draws levels and shows context, it never places orders and gives no buy or sell advice. It uses no DLL. Personal use on your own charts. Past averages and past price behaviour do not predict the future."
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

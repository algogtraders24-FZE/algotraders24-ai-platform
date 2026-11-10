// scripts/create-at24-mt4-batch5-listings.ts
// AT24 education tools for MetaTrader 4 (licensed non-trading utility EAs), 11 USD each. Usage:
//   npx tsx scripts/create-at24-mt4-batch5-listings.ts            -> creates/updates the listings as DRAFT (not visible)
//   npx tsx scripts/create-at24-mt4-batch5-listings.ts --publish  -> also sets publicationState PUBLISHED
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
    "slug": "at24-effect-tracker-mt4",
    "title": "AT24 Effect Tracker (MT4)",
    "tradingSystemId": "AT24-EFFECT-TRACKER-MT4",
    "version": "1.00",
    "zip": "AT24_EffectTracker_MT4_v1.00.zip",
    "icon": "effect_tracker-icon.png",
    "banner": "effect-tracker-mt4-banner.png",
    "tags": [
      "indicator",
      "hour-of-day",
      "seasonality",
      "change-point",
      "statistics",
      "research",
      "dashboard",
      "gold",
      "mt4",
      "demo-tested"
    ],
    "description": "'This hour always moves' is repeated everywhere, and even real hourly effects tend to fade. AT24 Effect Tracker for MetaTrader 4 checks, on your own symbol, whether each New York hour's average return is still significant now, was significant in the window before, or just appeared - and where its average most likely changed.\n\nWhat you get\n- A status per hour: ALIVE, NEWBORN, DIED or no effect, from the t-statistic of the latest window against the window before (window length is an input, 250 trading days by default).\n- A chance check: how many of the 24 hours are significant now against the roughly one in 24 that chance alone gives at |t| of 2.\n- For the hours that changed status first: their averages in both windows and the most likely change point (CUSUM test).\n- The broker clock is detected automatically (other FX pairs are tried if the chart symbol cannot be used) and can be set by hand in the inputs. Dashboard is off in the Strategy Tester by default.\n\nWhat was verified: compiles with 0 errors and 0 warnings in MetaEditor 4 and runs on an MT4 Exness demo terminal on XAUUSD H1 (about 40,000 hourly bars, 250-day windows: 4 of 24 hours significant now against about 1.1 expected by chance; alive 1, newborn 3, died 1 - see the screenshot). The broker clock was detected from EURUSD hourly data rebuilt from the demo's 15-minute history. These numbers are historical and descriptive: an hour that looks alive may be a spread or data artefact, a significant hour that dies is normal, and nothing here is a signal or shows an edge.\nNot verified: live-money use, other symbols and brokers, the licence check with a real purchase on MT4. It is delivered as a non-trading utility Expert Advisor (MT4 does not allow licence checks inside indicators). MetaTrader 4 only.\n\nEducation tool, not a signal: it draws levels and shows context, it never places orders and gives no buy or sell advice. It uses no DLL. Personal use on your own charts. Past averages and past price behaviour do not predict the future."
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

// scripts/create-at24-flow-meter-listings.ts
// AT24 Flow Meter - MT5 (licensed non-trading utility EA that embeds the indicator), 11 USD.
//   npx tsx scripts/create-at24-flow-meter-listings.ts            -> creates/updates the listings as DRAFT (not visible)
//   npx tsx scripts/create-at24-flow-meter-listings.ts --publish  -> also sets publicationState PUBLISHED
// MT5 tradingSystemId doubles as the licence gate's product id (AT24-FLOW-METER).
// Claims rule: no 'institutional order flow', no 'smart money', no profit promises; delta is an estimate unless the badge says REAL; no real order flow claims for CFD feeds.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const PRICE_USD = 33; // set by the owner
const ROOT = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m18-at24-indicators");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const FOOT = `\n\nDescriptive history on your own broker data. Context tool, not a signal or a forecast; it is a descriptive context tool: it places no orders and gives no signals, delta is an estimate unless the badge says REAL, and past behaviour does not predict future results. Not financial advice. Not financial advice. Trading leveraged products is risky.`;

const LICENCE = `\n\nLICENCE KEY: the download is protected by your AT24 licence key. One key works on ONE trading account at a time and only for this product; you can move it to another account yourself (2 changes per 30 days) from Dashboard > Purchases. After buying, paste the key from your purchase page into the EA input "InpLicenseKey" and allow https://www.algotraders24.ai under Tools > Options > Expert Advisors > Allow WebRequest. The Strategy Tester needs no key.`;

const RESULT = `BTCUSD M15 on an IC Markets demo feed: with the tick bars input set to 5 the badge read TICK-RULE ESTIMATE (last 5 bars from ticks, older bars from the bar proxy); with the default input the demo had no tick history and the badge read BAR PROXY. The histogram, the daily cumulative line and two delta divergence marks on closed bars were drawn, and the terminal reported no slow-indicator warning. This demo feed carries no buy/sell flags, so a real delta mode is not available on it.`;

type Product = { slug: string; title: string; tradingSystemId: string; version: string; platform: string; zip: string; banner: string; tags: string[]; description: string };

const PRODUCTS: Product[] = [
  {
    slug: "at24-flow-meter",
    title: "AT24 Flow Meter",
    tradingSystemId: "AT24-FLOW-METER",
    version: "1.00",
    platform: "MT5",
    zip: "AT24_FlowMeter_MT5_v1.00.zip",
    banner: "flow-meter-banner.png",
    tags: ["indicator", "delta", "cumulative-delta", "tick-volume", "order-flow-context", "dashboard", "research", "mt5", "demo-tested"],
    description: `AT24 Flow Meter shows the delta and the cumulative delta, and tells you what kind of delta it is: real, estimated from ticks, or estimated from bars.

On forex and CFD feeds an estimate is often shown as if it were real order flow. Flow Meter does not do that. A badge always states how the delta was obtained, so you know what you are looking at.

What you get
- A sub-window with per-bar delta and a cumulative delta that restarts every day.
- A badge: REAL (the feed flags buyer and seller trades), TICK-RULE ESTIMATE, or BAR PROXY (from bar shape and tick volume).
- Darker bars where tick data is available, lighter bars for older history.
- Delta divergence marks on the price chart, on closed bars only, and an optional alert once per bar.
- It never places orders and gives no signals.

On most forex and CFD feeds the delta is an estimate, and the badge says so. Divergence is context, not a trade signal. Past behaviour does not predict future results. Not financial advice.

It is delivered as a non-trading utility Expert Advisor with the indicator built into the file (MT5 does not allow licence checks inside indicators): attach it to a chart and the sub-window appears.

What was verified: compiles with 0 errors and 0 warnings in the real MetaEditor and runs on a real MT5 chart (see the screenshot). The calculation matches an independent Python calculation on 83,924 real exchange trades and on 3,000 XAUUSD bars. On the IC Markets demo used for testing there are no buy or sell flags: with the tick bars input set to 5 the badge read TICK-RULE ESTIMATE, and with the default input (the demo keeps almost no tick history) it read BAR PROXY. Many brokers keep little tick history, so the number of tick bars may be smaller than the input. Not verified: a REAL delta feed on a connected terminal, and the alert.
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
    await copyFile(path.join(ROOT, "branding", "flow_meter-icon.png"), path.join(mediaDir, "icon2.png"));
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

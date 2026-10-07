// scripts/create-copier-listing.ts
// AT24 Local Trade Copier - one marketplace listing per direction
// (MT5->MT5, MT5->MT4, MT4->MT4, MT4->MT5). Usage:
//   npx tsx scripts/create-copier-listing.ts MT5_to_MT5
//
// A copier is a UTILITY, not a trading strategy: there is no backtest/risk
// evidence to run through M2-M7, so the listing deliberately carries NO Trust
// State (it shows the honest "Not yet verified" label) and its description
// states exactly what WAS verified (compile, in-terminal protocol self-test,
// end-to-end demo test) and what was not. Visibility follows the documented,
// user-directed pre-evidence pattern of publish-catalog-import-override.ts:
// publicationState is set to PUBLISHED explicitly; trustState is never touched.
//
// The customer download is a .zip (Master + Receiver + README) stored as
// private-releases/<releaseId>.zip and served by the licensed download route.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const TRADING_SYSTEM_ID = "AT24-LOCAL-COPIER";
const VERSION = "1.0.0";
const PRICE_USD = 79;
const ROOT = path.join(__dirname, "..", "..", "ea-research");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

interface Direction {
  key: string;
  slug: string;
  title: string;
  platformTag: "MT5" | "MT4"; // platform of the SOURCE (Master) terminal - release.platform must equal this
  from: "MT4" | "MT5";
  to: "MT4" | "MT5";
  icon: string;
  tested: string;
  notTested: string;
}

const COMMON_TESTED = "Compiles with 0 errors / 0 warnings in the real MetaEditor.";

const DIRECTIONS: Record<string, Direction> = {
  MT5_to_MT5: {
    key: "MT5_to_MT5",
    slug: "at24-local-trade-copier-mt5-to-mt5",
    title: "AT24 Local Trade Copier - MT5 to MT5",
    platformTag: "MT5",
    from: "MT5",
    to: "MT5",
    icon: path.join(ROOT, "marketplace-research", "m16-copier", "branding", "copier-mt5-to-mt5-icon.svg"),
    tested:
      `${COMMON_TESTED} A protocol self-test running INSIDE a real MT5 terminal passed 41 of 41 checks (CRC-32, tamper and partial-write detection, symbol mapping, lot maths). ` +
      "An end-to-end test on a real MT5 hedging DEMO account (Master and Receiver in one terminal, loopback) passed 17 of 17 checks in normal mode and 17 of 17 in ReverseCopy mode: new position, SL/TP change, partial close, a second position, close - nothing left behind. On that demo a new position was copied in roughly 0.3-0.5 s and later changes in roughly 0.2-0.6 s (your PC and broker will differ; not a guarantee).",
    notTested:
      "Separate terminals from different brokers on this build, a netting SOURCE account, live-money accounts, and brokers that forbid hedging or copying.",
  },
};

function describe(d: Direction): string {
  return `AT24 Local Trade Copier copies the open positions of one MetaTrader ${d.from.slice(2)} account to another MetaTrader ${d.to.slice(2)} account on the same computer or VPS. A small Master EA publishes the account's open positions to a file in the shared Common folder; a Receiver EA in the other terminal mirrors them: new positions, stop loss / take profit changes, partial closes, added volume and closes. No server, no DLL, no internet connection and no account password - everything stays on your machine and nothing is sent to AT24.

What you get: the Master (${d.from}) and the Receiver (${d.to}) as compiled EAs plus a setup guide, in one download.

Features
- Lot sizing: multiplier, fixed lot, or equity ratio; hard cap per trade
- Reverse copy (buys become sells; SL and TP are swapped)
- Symbol suffix handling and an explicit symbol map (e.g. XAUUSD=GOLD)
- Allowed-symbol and master-magic filters, spread and slippage limits, DryRun mode
- Safe by default: positions already open when the Receiver starts are NOT copied; a silent/offline Master never causes any action; a half-written file is detected by checksum and ignored; the copies are closed on an empty master book only after a confirmation delay; open attempts per trade are capped
- Every copy has its own magic number and a tag, so your manual trades and other EAs are never touched; copies stay mappable even when a broker rewrites the position comment

Limits (v${VERSION}): pending orders are not copied (only filled positions); same computer only; the destination MT5 account must be a hedging account; it cannot run in the Strategy Tester.

What was verified: ${d.tested}
Not verified: ${d.notTested} Always try it on a demo account first.

This is a utility - it contains no trading strategy, so there is no backtest or performance claim, and that is why this listing shows no Trust State. Check that your broker allows trade copying and hedging; copying trades of accounts you do not own or manage, or selling signals, can require a licence in your country - you are responsible for compliance. Trading leveraged products is risky.`;
}

async function main() {
  const key = process.argv[2];
  const d = key ? DIRECTIONS[key] : undefined;
  if (!d) throw new Error(`Usage: create-copier-listing.ts <${Object.keys(DIRECTIONS).join("|")}>`);

  const seller = await prisma.user.findFirst({ where: { email: SELLER_EMAIL }, select: { id: true } });
  if (!seller) throw new Error(`No User found for ${SELLER_EMAIL}`);

  const versionId = `${TRADING_SYSTEM_ID}-${d.from}-${d.to}-v${VERSION}`;
  const zipName = `AT24_Local_Copier_${d.key}_v${VERSION}.zip`;
  const bytes = await readFile(path.join(ROOT, "at24-copier", "dist", zipName));
  const artifactHash = createHash("sha256").update(bytes).digest("hex");

  await mkdir(RELEASES_DIR, { recursive: true });
  const release = await prisma.releaseArtifact.upsert({
    where: { tradingSystemId_versionId_platform_artifactHash: { tradingSystemId: TRADING_SYSTEM_ID, versionId, platform: d.platformTag, artifactHash } },
    create: { tradingSystemId: TRADING_SYSTEM_ID, versionId, platform: d.platformTag, artifactVersion: `v${VERSION}`, artifactHash, releaseStatus: "PUBLISHED" },
    update: { releaseStatus: "PUBLISHED" },
  });
  await writeFile(path.join(RELEASES_DIR, `${release.id}.zip`), bytes);
  await writeFile(path.join(RELEASES_DIR, `${release.id}.filename.txt`), zipName, "utf-8");

  const description = describe(d);
  const tags = ["trade-copier", "copier", "utility", "local", d.from.toLowerCase(), d.to.toLowerCase()];
  const listing = await prisma.marketplaceListing.upsert({
    where: { slug: d.slug },
    create: {
      sellerId: seller.id, slug: d.slug, title: d.title, description,
      media: [], pricing: { model: "one_time", amount: PRICE_USD, currency: "USD" },
      category: "Utility", platformTag: d.platformTag, assetTag: "Multi-asset", tags,
      tradingSystemId: TRADING_SYSTEM_ID, versionId,
      publicationState: "DRAFT",
    },
    update: { description, tags, versionId, tradingSystemId: TRADING_SYSTEM_ID },
  });

  const mediaDir = path.join(__dirname, "..", "public", "marketplace", listing.id);
  await mkdir(mediaDir, { recursive: true });
  await copyFile(d.icon, path.join(mediaDir, "icon.svg"));
  const media = [`/marketplace/${listing.id}/icon.svg`];

  // Explicit, documented visibility (see header). trustState / evidence fields are never touched.
  const published = await prisma.marketplaceListing.update({
    where: { id: listing.id },
    data: { media, publicationState: "PUBLISHED" },
  });

  console.log("Listing:", published.id, published.slug, "| publicationState:", published.publicationState, "| trustState:", published.trustState ?? "(none - utility)");
  console.log("Release:", release.id, "->", `${release.id}.zip`, "sha256", artifactHash);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

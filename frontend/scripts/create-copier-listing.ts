// scripts/create-copier-listing.ts
// AT24 Local Trade Copier - one marketplace listing per direction
// (MT5->MT5, MT5->MT4, MT4->MT4, MT4->MT5). Usage:
//   npx tsx scripts/create-copier-listing.ts MT5_to_MT5
//
// A copier is a UTILITY, not a trading strategy: there is no backtest/risk
// evidence to run through M2-M7, so the listing deliberately carries NO Trust
// State (it shows the honest "Not checked" label) and its description
// states exactly what WAS verified (compile, in-terminal protocol self-test,
// end-to-end demo test) and what was not. Visibility follows the documented,
// user-directed pre-evidence pattern of publish-catalog-import-override.ts:
// publicationState is set to PUBLISHED explicitly; trustState is never touched.
//
// The customer download is a .zip (Master + Receiver + README) stored as
// private-releases/<releaseId>.zip and served by the licensed download route.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile, rm } from "fs/promises";
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
  destNote: string;
  icon: string;
  tested: string;
  notTested: string;
}

const COMMON_TESTED = "Both EAs compile with 0 errors / 0 warnings in the real MetaEditor.";
const BRANDING = path.join(ROOT, "marketplace-research", "m16-copier", "branding");

const HEDGE_MT5 = "the destination MT5 account must be a hedging account";
const HEDGE_MT4 = "the destination MT4 broker must allow hedging (opposite orders on one symbol) and must not enforce a FIFO rule";

const DIRECTIONS: Record<string, Direction> = {
  MT5_to_MT5: {
    key: "MT5_to_MT5",
    slug: "at24-local-trade-copier-mt5-to-mt5",
    title: "AT24 Trade Copier MT5 to MT5",
    platformTag: "MT5",
    from: "MT5",
    to: "MT5",
    destNote: HEDGE_MT5,
    icon: path.join(BRANDING, "copier-mt5-to-mt5-icon.svg"),
    tested:
      `${COMMON_TESTED} A protocol self-test running INSIDE a real MT5 terminal passed 47 of 47 checks (CRC-32, tamper and partial-write detection, symbol prefix/suffix mapping, lot maths). ` +
      "An end-to-end test on a real MT5 hedging DEMO account (Master and Receiver in one terminal, loopback) passed 17 of 17 checks in normal mode and 17 of 17 in ReverseCopy mode. " +
      "A cross-broker test with two separate MT5 terminals - Master on an Equiti demo account (symbol EURUSD.sd), Receiver on an Exness demo account (EURUSD, suffix .sd stripped) - passed every step: new position copied at half volume, SL/TP change, partial close, a second position, its close, and the final close; a position that already existed on the receiving account stayed untouched. Measured on those demos: each action was mirrored in roughly 0.2-1.0 s (your PC and broker will differ; not a guarantee). The prefix option is covered by the in-terminal self-test; no live broker symbol with a prefix was available to trade it.",
    notTested: "A netting SOURCE account, live-money accounts, brokers that forbid hedging or copying, and a live trade on a prefixed broker symbol.",
  },
  MT5_to_MT4: {
    key: "MT5_to_MT4",
    slug: "at24-local-trade-copier-mt5-to-mt4",
    title: "AT24 Trade Copier MT5 to MT4",
    platformTag: "MT5",
    from: "MT5",
    to: "MT4",
    destNote: HEDGE_MT4,
    icon: path.join(BRANDING, "copier-mt5-to-mt4-icon.svg"),
    tested:
      `${COMMON_TESTED} The shared protocol self-test passed 47 of 47 checks inside a real MT5 terminal and 47 of 47 inside a real MT4 terminal (running it in MT4 found a genuine MT4 difference in string trimming, fixed before release). ` +
      "A live cross-platform, cross-broker test - Master = MT5 on an Equiti demo account (EURUSD.sd), Receiver = MT4 on an Exness demo account (EURUSD, suffix .sd stripped) - passed every step: new position at half volume, SL/TP change, partial close (MT4 gives the remaining volume a new ticket and the Receiver followed it), a second position, its close, and the final close. Measured on those demos: each action was mirrored in roughly 0.2-0.8 s (not a guarantee). " +
      "That testing also found a real duplicate-copy bug when two Receivers were attached to one channel by accident, which led to the built-in one-Receiver-per-channel lock; the final run deliberately attached the Receiver to three charts and only one acted.",
    notTested: "Brokers with a FIFO rule or hedging prohibited, live-money accounts, brokers that forbid copying.",
  },
  MT4_to_MT4: {
    key: "MT4_to_MT4",
    slug: "at24-local-trade-copier-mt4-to-mt4",
    title: "AT24 Trade Copier MT4 to MT4",
    platformTag: "MT4",
    from: "MT4",
    to: "MT4",
    destNote: HEDGE_MT4,
    icon: path.join(BRANDING, "copier-mt4-to-mt4-icon.svg"),
    tested:
      `${COMMON_TESTED} The shared protocol self-test passed 47 of 47 checks inside a real MT4 terminal. ` +
      "A loopback test inside ONE MT4 terminal on an Exness demo account (Master and Receiver on two charts, the Receiver copying the Master's trades onto the same account) passed every step: new position at half volume, SL/TP change, partial close (the Master keeps the original position id when MT4 assigns the remainder a new ticket, so the copy is reduced rather than closed and re-opened), a second position, its close, and the final close, nothing left behind. Measured in that loopback: each action was mirrored in roughly 0.3-2.7 s (everything ran in one terminal; not a guarantee). " +
      "That testing also found a real duplicate-copy bug when two Receivers were attached to one channel by accident, which led to the built-in one-Receiver-per-channel lock.",
    notTested: "Two separate MT4 terminals on different brokers (only one MT4 demo terminal was available - treat this direction as less proven than the MT5 ones), brokers with a FIFO rule or hedging prohibited, live-money accounts.",
  },
  MT4_to_MT5: {
    key: "MT4_to_MT5",
    slug: "at24-local-trade-copier-mt4-to-mt5",
    title: "AT24 Trade Copier MT4 to MT5",
    platformTag: "MT4",
    from: "MT4",
    to: "MT5",
    destNote: HEDGE_MT5,
    icon: path.join(BRANDING, "copier-mt4-to-mt5-icon.svg"),
    tested:
      `${COMMON_TESTED} The shared protocol self-test passed 47 of 47 checks inside a real MT4 terminal and 47 of 47 inside a real MT5 terminal. ` +
      "A live cross-platform, cross-broker test - Master = MT4 on an Exness demo account (EURUSD), Receiver = MT5 hedging account on an Equiti demo (EURUSD.sd, suffix .sd added) - passed every step: new position at half volume, SL/TP change, partial close (the MT4 remainder kept its position id), a second position, its close, and the final close. Measured on those demos: each action was mirrored in roughly 0.2-1.5 s (not a guarantee).",
    notTested: "Netting destination accounts, live-money accounts, brokers that forbid copying.",
  },
};

function describe(d: Direction): string {
  return `AT24 Local Trade Copier copies the open positions of one MetaTrader ${d.from.slice(2)} account to another MetaTrader ${d.to.slice(2)} account on the same computer or VPS. A small Master EA publishes the account's open positions to a file in the shared Common folder; a Receiver EA in the other terminal mirrors them: new positions, stop loss / take profit changes, partial closes, added volume and closes. No server, no DLL, no internet connection and no account password - everything stays on your machine and nothing is sent to AT24.

What you get: the Master (${d.from}) and the Receiver (${d.to}) as compiled EAs plus a setup guide, in one download.

Features
- Lot sizing: multiplier, fixed lot, or equity ratio; hard cap per trade
- Reverse copy (buys become sells; SL and TP are swapped)
- Symbol prefix and suffix handling (strip the master's, add yours) and an explicit symbol map (e.g. XAUUSD=GOLD)
- Allowed-symbol and master-magic filters, spread and slippage limits, DryRun mode
- Safe by default: positions already open when the Receiver starts are NOT copied; a silent/offline Master never causes any action; a half-written file is detected by checksum and ignored; the copies are closed on an empty master book only after a confirmation delay; open attempts per trade are capped
- Every copy has its own magic number and a tag, so your manual trades and other EAs are never touched; copies stay mappable even when a broker rewrites the position comment

Test report (real demo accounts, 7 Oct 2026)
- Every master action was checked on the receiving account, not just "no error": a new position opens at the scaled volume with the master's SL/TP, an SL/TP change is followed, a partial close reduces the copy, a second position is copied, closing one position closes only its copy, the final close empties the book - and a position that already existed on the receiving account is left untouched.
- Testing found and fixed real bugs before release: MT4 text trimming differed from MT5 (symbol map / allowed list failed), two Receivers on one channel opened every trade twice (now blocked by a built-in lock), and MT4 gives the remainder of a partially closed order a new ticket (the copy is now followed instead of being closed and re-opened).
- Test logs with timings are kept; ask support if you want to see them.

Check it yourself in 5 minutes (demo only): attach the Master to a demo account, the Receiver to a second demo account with the same ChannelId; set the Receiver's DryRun to true and watch the log say what it WOULD do; then switch DryRun off, open a 0.01 trade on the master, change its stop loss, close half, close the rest - the copy should follow each step within about a second.

Limits (v${VERSION}): pending orders are not copied (only filled positions); same computer only; ${d.destNote}; it cannot run in the Strategy Tester.

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
  //--- A changed bundle has a new hash = a new release row. Retire the superseded rows (catalogue serves the newest
  //--- PUBLISHED one anyway) - but only rows nobody holds a licence on, and drop their stale files.
  const older = await prisma.releaseArtifact.findMany({
    where: { tradingSystemId: TRADING_SYSTEM_ID, versionId, platform: d.platformTag, id: { not: release.id }, releaseStatus: "PUBLISHED" },
    select: { id: true },
  });
  for (const o of older) {
    if ((await prisma.license.count({ where: { releaseId: o.id } })) > 0) continue;
    await prisma.releaseArtifact.update({ where: { id: o.id }, data: { releaseStatus: "DEPRECATED" } });
    await rm(path.join(RELEASES_DIR, `${o.id}.zip`), { force: true });
    await rm(path.join(RELEASES_DIR, `${o.id}.filename.txt`), { force: true });
    console.log("Deprecated superseded release", o.id);
  }
  await writeFile(path.join(RELEASES_DIR, `${release.id}.zip`), bytes);
  await writeFile(path.join(RELEASES_DIR, `${release.id}.filename.txt`), zipName, "utf-8");

  const description = describe(d);
  const tags = ["trade-copier", "copier", "utility", "demo-tested", "local", d.from.toLowerCase(), d.to.toLowerCase()];
  const listing = await prisma.marketplaceListing.upsert({
    where: { slug: d.slug },
    create: {
      sellerId: seller.id, slug: d.slug, title: d.title, description,
      media: [], pricing: { model: "one_time", amount: PRICE_USD, currency: "USD" },
      category: "Utility", platformTag: d.platformTag, assetTag: "Multi-asset", tags,
      tradingSystemId: TRADING_SYSTEM_ID, versionId,
      publicationState: "DRAFT",
    },
    update: { title: d.title, description, tags, versionId, tradingSystemId: TRADING_SYSTEM_ID },
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

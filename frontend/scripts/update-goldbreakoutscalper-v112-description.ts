// scripts/update-goldbreakoutscalper-v112-description.ts
// Adds ONE honest paragraph about release v1.12 to the AT24 Gold Breakout Scalper listing (marker "VERSION 1.12"; running it twice changes nothing).
// The evidence block of the listing stays: it is true for v1.00 and the paragraph says so.
// Usage: npx tsx scripts/update-goldbreakoutscalper-v112-description.ts
import "dotenv/config";
import { prisma } from "../lib/prisma";

const SLUG = "at24-gold-breakout-scalper";
const MARKER = "VERSION 1.12";
const PARAGRAPH = `

VERSION 1.12 (October 2026): the download is now release 1.12. It trades gold on the chart symbol only and counts spread, your broker's commission and a slippage allowance in its breakeven, trailing stop and entry filter; it has a working trend filter, rebuilds its pending orders every bar, handles broker freeze/stops levels, limits the rate of stop modifications, offers a fixed lot or an automatic lot that follows the account, and shows a chart dashboard. The evidence shown above was produced with the first release (v1.00); release 1.12 has NOT been validated by that pipeline. In the seller's own Strategy Tester runs on real ticks (XAUUSD M5, October 2026) the default settings were around break-even; results on 1-minute OHLC data are far better than on real ticks. Start on a demo account with a small lot.`;

async function main() {
  const listing = await prisma.marketplaceListing.findFirst({ where: { slug: SLUG, deletedAt: null } });
  if (!listing) throw new Error(`Listing ${SLUG} not found`);
  if (listing.description.includes(MARKER)) {
    console.log(`[${SLUG}] description already has the v1.12 paragraph`);
    return;
  }
  await prisma.marketplaceListing.update({ where: { id: listing.id }, data: { description: listing.description + PARAGRAPH } });
  console.log(`[${SLUG}] v1.12 paragraph added`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

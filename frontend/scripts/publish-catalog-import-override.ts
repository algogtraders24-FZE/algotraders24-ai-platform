// scripts/publish-catalog-import-override.ts
// Explicit, user-directed pre-evidence override (same pattern as
// publish-pdhpdl-gold-listing-override.ts) - the user explicitly asked to
// make all 16 catalog-import listings publicly visible NOW, with real
// backtest evidence to follow per-product later ("abhi sabko marketplace
// me show kardo, baad me report update kardena"). This bypasses the real
// v2 eligibility gate (which correctly blocks UNVERIFIED trust from
// publication) by DIRECT, DOCUMENTED override - never a silent bypass.
//
// What this does NOT do: it never touches trustState. Every one of these
// 16 listings keeps showing the real, honest "UNVERIFIED" Trust State
// badge, everywhere, always - only publicationState changes, so they
// become browsable/purchasable-once-a-release-exists while still telling
// every visitor plainly that no independent evidence has been submitted
// yet. If real evidence is built later for any of these (same M2-M7 work
// already done for AT24 Gold Range Breaker / Gold Fire v5), re-run
// load-marketplace-evidence.ts for it - trustState will update honestly
// then, same as any other product.
import "dotenv/config";
import { prisma } from "../lib/prisma";

const SLUGS = [
  "at24-axon-24", "at24-axon-pro-26", "at24-global-commodity-matrix",
  "at24-nexusmining-exploration-algo", "at24-quantumtech-nas", "at24-quantum-gold-ai",
  "at24-quantum-index-engine", "at24-quantum-wallstreet-pro", "at24-quantumpulse-btc",
  "at24-silver-mining-algo", "at24-cmdt-print-ai", "at24-gold-footprint-alpha",
  "at24-oil-pulse-expert", "at24-pivot-scanner-pro", "at24-deltaprint-btc", "at24-deltaprint-btc-pro",
];

async function main() {
  for (const slug of SLUGS) {
    const listing = await prisma.marketplaceListing.update({
      where: { slug },
      data: { publicationState: "PUBLISHED" },
    });
    console.log(`${listing.title}: publicationState=${listing.publicationState} trustState=${listing.trustState} (unchanged, honest)`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

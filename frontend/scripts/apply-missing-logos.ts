// scripts/apply-missing-logos.ts
// Fills in real, distinct poster-style icons for every live marketplace
// listing that was still on the generic shared placeholder
// (/assets/products/placeholder.png) - copies the real SVG from
// ea-research/marketplace-research/m15-new-products/branding/ into this
// listing's own public/marketplace/<id>/icon.svg and points `media` at
// it, replacing the placeholder reference.
import "dotenv/config";
import { mkdir, copyFile } from "fs/promises";
import path from "path";
import { prisma } from "../lib/prisma";

const BRANDING_DIR = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m15-new-products", "branding");

const SLUG_TO_ICON: Record<string, string> = {
  "nifty-algo-pro": "nifty-algo-pro-icon.svg",
  "ninja-momentum-bot": "ninja-momentum-bot-icon.svg",
  "tv-breakout-strategy": "tv-breakout-strategy-icon.svg",
  "crypto-grid-bot": "crypto-grid-bot-icon.svg",
  "ctrader-swing-cbot": "ctrader-swing-cbot-icon.svg",
  "smart-money-indicator": "smart-money-indicator-icon.svg",
  "at24-fx-pairs-reversion": "at24-fx-pairs-reversion-icon.svg",
  "at24-mt4-volatility-squeeze": "at24-mt4-volatility-squeeze-icon.svg",
  "axon-signal-engine": "axon-signal-engine-icon.svg",
  "volatility-shield": "volatility-shield-icon.svg",
};

async function main() {
  for (const [slug, iconFile] of Object.entries(SLUG_TO_ICON)) {
    const listing = await prisma.marketplaceListing.findUnique({ where: { slug }, select: { id: true, media: true } });
    if (!listing) {
      console.log(`${slug}: SKIP - no listing found`);
      continue;
    }
    const mediaDir = path.join(__dirname, "..", "public", "marketplace", listing.id);
    await mkdir(mediaDir, { recursive: true });
    await copyFile(path.join(BRANDING_DIR, iconFile), path.join(mediaDir, "icon.svg"));

    const media = [`/marketplace/${listing.id}/icon.svg`];
    await prisma.marketplaceListing.update({ where: { id: listing.id }, data: { media } });
    console.log(`${slug}: id=${listing.id} media -> ${JSON.stringify(media)} (was ${JSON.stringify(listing.media)})`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

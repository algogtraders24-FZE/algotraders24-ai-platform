// scripts/update-at24-indicator-media.ts
// Gives each AT24 indicator listing its OWN icon (one logo per product, so buyers never confuse them) and the
// matching banner. Files are copied to public/marketplace/<listingId>/icon2.png + banner2.png (new names so
// caches do not serve the old ones) and the listing media is pointed at them. Run from the frontend folder:
//   npx tsx scripts/update-at24-indicator-media.ts
import "dotenv/config";
import { mkdir, copyFile } from "fs/promises";
import path from "path";
import { prisma } from "../lib/prisma";

const ROOT = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m18-at24-indicators", "branding");

const MAP: { slug: string; icon: string; banner: string }[] = [
  { slug: "at24-pivot-levels-map", icon: "pivot_levels_map-icon.png", banner: "pivot-levels-map-banner.png" },
  { slug: "at24-hourly-range-heatmap", icon: "hourly_range_heatmap-icon.png", banner: "hourly-range-heatmap-banner.png" },
  { slug: "at24-spread-by-hour", icon: "spread_by_hour-icon.png", banner: "spread-by-hour-banner.png" },
  { slug: "at24-pivot-levels-map-tradingview", icon: "pivot_levels_map-icon.png", banner: "pivot-levels-map-tv-banner.png" },
  { slug: "at24-hourly-range-heatmap-tradingview", icon: "hourly_range_heatmap-icon.png", banner: "hourly-range-heatmap-tv-banner.png" },
];

async function main() {
  for (const m of MAP) {
    const listing = await prisma.marketplaceListing.findFirst({ where: { slug: m.slug, deletedAt: null }, select: { id: true } });
    if (!listing) { console.log("missing listing", m.slug); continue; }
    const dir = path.join(__dirname, "..", "public", "marketplace", listing.id);
    await mkdir(dir, { recursive: true });
    await copyFile(path.join(ROOT, m.icon), path.join(dir, "icon2.png"));
    await copyFile(path.join(ROOT, m.banner), path.join(dir, "banner2.png"));
    await prisma.marketplaceListing.update({ where: { id: listing.id }, data: { media: [`/marketplace/${listing.id}/icon2.png`, `/marketplace/${listing.id}/banner2.png`] } });
    console.log(m.slug, "->", listing.id);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

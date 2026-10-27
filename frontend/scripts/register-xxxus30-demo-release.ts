// scripts/register-xxxus30-demo-release.ts
// Registers the XXX US30 30-day DEMO build as its own PUBLISHED release (different versionId from the paid release, so a purchase never
// picks it) and copies the zip into private-releases/<releaseId>.zip - the same convention every other release uses.
// Run order: build the demo (build_xxxus30_demo_source.py -> compile -> build_xxxus30_demo_bundle.py), then:
//   npx tsx scripts/register-xxxus30-demo-release.ts
// Re-running with a changed zip creates a NEW release row (new hash) and deprecates the old one when nobody holds a licence on it.
import "dotenv/config";
import { readFile, writeFile, mkdir, rm } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const TRADING_SYSTEM_ID = "XXXUS30";
const VERSION_ID = "XXXUS30-DEMO-v1.03"; // stable id: services/trial/trialService.ts looks the demo release up by it (artifactVersion carries the real version)
const LISTING_SLUG = "xxx-us30-multi-module-breakout";
const ZIP = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m15-new-products", "source", "XXXUS30_demo_v1.14.zip");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

async function main() {
  const bytes = await readFile(ZIP);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const listing = await prisma.marketplaceListing.findFirst({ where: { slug: LISTING_SLUG, deletedAt: null }, select: { id: true } });
  if (!listing) throw new Error(`Listing ${LISTING_SLUG} not found`);
  await mkdir(RELEASES_DIR, { recursive: true });
  const release = await prisma.releaseArtifact.upsert({
    where: { tradingSystemId_versionId_platform_artifactHash: { tradingSystemId: TRADING_SYSTEM_ID, versionId: VERSION_ID, platform: "MT5", artifactHash: hash } },
    create: { tradingSystemId: TRADING_SYSTEM_ID, versionId: VERSION_ID, platform: "MT5", marketplaceListingId: listing.id, artifactVersion: "demo-v1.14", artifactHash: hash, releaseStatus: "PUBLISHED" },
    update: { releaseStatus: "PUBLISHED" },
  });
  const older = await prisma.releaseArtifact.findMany({ where: { tradingSystemId: TRADING_SYSTEM_ID, versionId: VERSION_ID, platform: "MT5", id: { not: release.id }, releaseStatus: "PUBLISHED" }, select: { id: true } });
  for (const o of older) {
    if ((await prisma.license.count({ where: { releaseId: o.id } })) > 0) continue;
    await prisma.releaseArtifact.update({ where: { id: o.id }, data: { releaseStatus: "DEPRECATED" } });
    await rm(path.join(RELEASES_DIR, `${o.id}.zip`), { force: true });
    await rm(path.join(RELEASES_DIR, `${o.id}.filename.txt`), { force: true });
    console.log("Deprecated superseded demo release", o.id);
  }
  await writeFile(path.join(RELEASES_DIR, `${release.id}.zip`), bytes);
  await writeFile(path.join(RELEASES_DIR, `${release.id}.filename.txt`), "XXXUS30_demo_v1.14.zip", "utf-8");
  console.log("Demo release:", release.id, "sha256", hash.slice(0, 16), "| file written to private-releases/");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

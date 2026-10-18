// scripts/publish-licensed-release.ts
// Publishes a NEW licence-protected build of an existing owner product (XXX US30 / XXX BTC ...):
//   - new ReleaseArtifact row (new hash = new release, same tradingSystemId/versionId/platform), file into private-releases/
//   - the older PUBLISHED build is DEPRECATED only if nobody holds a licence on it (buyers keep what they own)
//   - a licence paragraph is appended to the listing description once (marker: "LICENCE KEY")
// Usage: npx tsx scripts/publish-licensed-release.ts <tradingSystemId> <zipPath> <artifactVersion> <downloadFileName>
//   e.g. npx tsx scripts/publish-licensed-release.ts XXXUS30 ../ea-research/marketplace-research/m15-new-products/source/XXXUS30_v1.02.zip v1.02 XXXUS30_v1.02.zip
// Commit the new private-releases/<id>.zip + .filename.txt and push; the release is downloadable once that deploy is live.
import "dotenv/config";
import { readFile, writeFile, mkdir, rm } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const RELEASES_DIR = path.join(__dirname, "..", "private-releases");
const LICENCE_PARAGRAPH = `

LICENCE KEY: the download is protected by your AT24 licence key. One key works on ONE trading account at a time and only for this product; you can move it to another account yourself (2 changes per 30 days) from Dashboard > Purchases. After buying, paste the key from your purchase page into the EA input "InpLicenseKey" and allow https://www.algotraders24.ai under Tools > Options > Expert Advisors > Allow WebRequest. The Strategy Tester needs no key.`;

async function main() {
  const [tradingSystemId, zipPath, artifactVersion, fileName] = process.argv.slice(2);
  if (!tradingSystemId || !zipPath || !artifactVersion || !fileName) throw new Error("usage: <tradingSystemId> <zipPath> <artifactVersion> <downloadFileName>");
  const listing = await prisma.marketplaceListing.findFirst({ where: { tradingSystemId, deletedAt: null, publicationState: "PUBLISHED" } });
  if (!listing?.versionId) throw new Error(`No published listing for ${tradingSystemId}`);
  const versionId = listing.versionId;

  const bytes = await readFile(path.resolve(zipPath));
  const artifactHash = createHash("sha256").update(bytes).digest("hex");
  await mkdir(RELEASES_DIR, { recursive: true });
  const release = await prisma.releaseArtifact.upsert({
    where: { tradingSystemId_versionId_platform_artifactHash: { tradingSystemId, versionId, platform: "MT5", artifactHash } },
    create: { tradingSystemId, versionId, platform: "MT5", artifactVersion, artifactHash, releaseStatus: "PUBLISHED" },
    update: { releaseStatus: "PUBLISHED" },
  });
  await writeFile(path.join(RELEASES_DIR, `${release.id}.zip`), bytes);
  await writeFile(path.join(RELEASES_DIR, `${release.id}.filename.txt`), fileName, "utf-8");
  console.log("New release:", release.id, artifactVersion, artifactHash.slice(0, 16));

  const older = await prisma.releaseArtifact.findMany({ where: { tradingSystemId, versionId, platform: "MT5", id: { not: release.id }, releaseStatus: "PUBLISHED" }, select: { id: true } });
  for (const o of older) {
    if ((await prisma.license.count({ where: { releaseId: o.id } })) > 0) {
      console.log("Kept older release (a buyer holds a licence on it):", o.id);
      continue;
    }
    await prisma.releaseArtifact.update({ where: { id: o.id }, data: { releaseStatus: "DEPRECATED" } });
    console.log("Deprecated superseded release:", o.id, "(its file stays in git history; remove it from private-releases if you like)");
  }

  if (!listing.description.includes("LICENCE KEY")) {
    await prisma.marketplaceListing.update({ where: { id: listing.id }, data: { description: listing.description + LICENCE_PARAGRAPH } });
    console.log("Listing description: licence paragraph added");
  } else {
    console.log("Listing description already mentions the licence key");
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());

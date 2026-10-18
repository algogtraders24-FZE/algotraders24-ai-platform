// scripts/publish-licensed-release.ts
// Publishes a NEW licence-protected build of an existing owner product (identified by its LISTING SLUG):
//   - new ReleaseArtifact row (new hash = new release; tradingSystemId / versionId / platform come from the listing), file into private-releases/
//   - the older PUBLISHED build is DEPRECATED only if nobody holds a licence on it (buyers keep what they own)
//   - the listing description gets one licence paragraph (marker "LICENCE KEY"); for the copier the old "no internet" sentence is corrected
// Usage: npx tsx scripts/publish-licensed-release.ts <listingSlug> <zipPath> <artifactVersion> <downloadFileName> [ea|copier]
// Commit the new private-releases/<id>.zip + .filename.txt and push; the release is downloadable once that deploy is live.
import "dotenv/config";
import { readFile, writeFile, mkdir } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const EA_PARAGRAPH = `

LICENCE KEY: the download is protected by your AT24 licence key. One key works on ONE trading account at a time and only for this product; you can move it to another account yourself (2 changes per 30 days) from Dashboard > Purchases. After buying, paste the key from your purchase page into the EA input "InpLicenseKey" and allow https://www.algotraders24.ai under Tools > Options > Expert Advisors > Allow WebRequest. The Strategy Tester needs no key.`;

const COPIER_PARAGRAPH = `

LICENCE KEY: the Receiver (the EA on the account that copies the trades) is protected by your AT24 licence key; the Master needs none. One key works for ONE receiving account at a time; you can move it to another account yourself (2 changes per 30 days) from Dashboard > Purchases. After buying, paste the key from your purchase page into the Receiver input "InpLicenseKey" and allow https://www.algotraders24.ai under Tools > Options > Expert Advisors > Allow WebRequest in the destination terminal. The only data sent to AT24 is the key and the receiving account number and server name; no trade data leaves your computer.`;

const OLD_COPIER_SENTENCE = "No server, no DLL, no internet connection and no account password - everything stays on your machine and nothing is sent to AT24.";
const NEW_COPIER_SENTENCE = "No server, no DLL and no account password - your trade data stays on your machine. The Receiver contacts AT24 only to check your licence key (see Licence key below).";

async function main() {
  const [slug, zipPath, artifactVersion, fileName, kind = "ea"] = process.argv.slice(2);
  if (!slug || !zipPath || !artifactVersion || !fileName) throw new Error("usage: <listingSlug> <zipPath> <artifactVersion> <downloadFileName> [ea|copier]");
  const listing = await prisma.marketplaceListing.findFirst({ where: { slug, deletedAt: null, publicationState: "PUBLISHED" } });
  if (!listing?.versionId || !listing.tradingSystemId) throw new Error(`No published listing with a release for slug ${slug}`);
  const { tradingSystemId, versionId } = listing;
  const platform = listing.platformTag;

  const bytes = await readFile(path.resolve(zipPath));
  const artifactHash = createHash("sha256").update(bytes).digest("hex");
  await mkdir(RELEASES_DIR, { recursive: true });
  const release = await prisma.releaseArtifact.upsert({
    where: { tradingSystemId_versionId_platform_artifactHash: { tradingSystemId, versionId, platform, artifactHash } },
    create: { tradingSystemId, versionId, platform, artifactVersion, artifactHash, releaseStatus: "PUBLISHED" },
    update: { releaseStatus: "PUBLISHED" },
  });
  await writeFile(path.join(RELEASES_DIR, `${release.id}.zip`), bytes);
  await writeFile(path.join(RELEASES_DIR, `${release.id}.filename.txt`), fileName, "utf-8");
  console.log(`[${slug}] new release:`, release.id, artifactVersion, artifactHash.slice(0, 16));

  const older = await prisma.releaseArtifact.findMany({ where: { tradingSystemId, versionId, platform, id: { not: release.id }, releaseStatus: "PUBLISHED" }, select: { id: true } });
  for (const o of older) {
    if ((await prisma.license.count({ where: { releaseId: o.id } })) > 0) {
      console.log(`[${slug}] kept older release (a buyer holds a licence on it):`, o.id);
      continue;
    }
    await prisma.releaseArtifact.update({ where: { id: o.id }, data: { releaseStatus: "DEPRECATED" } });
    console.log(`[${slug}] deprecated superseded release:`, o.id);
  }

  let description = listing.description;
  if (kind === "copier" && description.includes(OLD_COPIER_SENTENCE)) description = description.replace(OLD_COPIER_SENTENCE, NEW_COPIER_SENTENCE);
  if (!description.includes("LICENCE KEY")) description += kind === "copier" ? COPIER_PARAGRAPH : EA_PARAGRAPH;
  if (description !== listing.description) {
    await prisma.marketplaceListing.update({ where: { id: listing.id }, data: { description } });
    console.log(`[${slug}] listing description updated`);
  } else {
    console.log(`[${slug}] listing description already up to date`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());

// scripts/register-releases.ts
// One-off, run-once script - registers the first real ReleaseArtifact rows
// for both live products, now that both EAs have been compiled with a
// real license-check (WebRequest to /api/license/activate + /validate)
// wired into OnInit()/OnTick() and compiled clean (0 errors, 0 warnings)
// via MetaEditor64.exe. This is what MarketplaceCatalogue.findRealRelease
// requires before PurchaseCTA will show a real Buy button instead of
// "coming soon" - see that function's own comment.
//
// The compiled .ex5 is copied into private-releases/<releaseId>.ex5 -
// deliberately OUTSIDE public/ (unlike icon/banner media), since this is
// the paid product itself and must never be reachable by an unauthenticated
// static-file request. app/api/private/licenses/[licenseId]/download/
// route.ts is the only real way to retrieve it, gated on the requester
// actually owning a License for this exact release.
import "dotenv/config";
import { readFile, mkdir, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const RELEASES = [
  {
    tradingSystemId: "GOLDFIRE",
    versionId: "GOLDFIRE-v5.00-2025-BASELINE",
    marketplaceListingId: "cmt8ovf9b0000uktpwls8jltp",
    artifactVersion: "v5.00",
    sourceEx5: path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m13-gold-fire-01", "source", "GoldFire_v5.ex5"),
    downloadFilename: "GoldFire_v5.ex5",
  },
  {
    tradingSystemId: "PDHPDL-GOLD",
    versionId: "PDHPDL-GOLD-v2x-2025-2026-EXTENDED-RUN",
    marketplaceListingId: "cmt1wc1ii0000lotp89riddpx",
    artifactVersion: "v2.10",
    sourceEx5: path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m12-gold-product-01", "source", "AT24_GOLD_PDHPDL_RangeBreaker_v2.10.ex5"),
    downloadFilename: "AT24_Gold_Range_Breaker_v2.10.ex5",
  },
];

async function main() {
  await mkdir(RELEASES_DIR, { recursive: true });

  for (const r of RELEASES) {
    const bytes = await readFile(r.sourceEx5);
    const artifactHash = createHash("sha256").update(bytes).digest("hex");

    const release = await prisma.releaseArtifact.upsert({
      where: { tradingSystemId_versionId_platform_artifactHash: { tradingSystemId: r.tradingSystemId, versionId: r.versionId, platform: "MT5", artifactHash } },
      create: {
        tradingSystemId: r.tradingSystemId,
        versionId: r.versionId,
        marketplaceListingId: r.marketplaceListingId,
        platform: "MT5",
        artifactVersion: r.artifactVersion,
        artifactHash,
        releaseStatus: "PUBLISHED",
      },
      update: { releaseStatus: "PUBLISHED", marketplaceListingId: r.marketplaceListingId },
    });

    await writeFile(path.join(RELEASES_DIR, `${release.id}.ex5`), bytes);
    // A human-readable filename mapping, so the download route can set a
    // real Content-Disposition filename without guessing from the id.
    await writeFile(path.join(RELEASES_DIR, `${release.id}.filename.txt`), r.downloadFilename, "utf-8");

    console.log(`${r.tradingSystemId} / ${r.versionId}: releaseId=${release.id} artifactHash=${artifactHash} status=${release.releaseStatus}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

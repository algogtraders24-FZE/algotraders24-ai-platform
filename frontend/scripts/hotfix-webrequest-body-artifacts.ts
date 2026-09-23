// scripts/hotfix-webrequest-body-artifacts.ts
// Real hotfix (2026-09-22): AT24_PostJson's WebRequest body construction
// had a fragile null-terminator assumption that could truncate the real
// JSON body sent to /api/license/activate, causing a live buyer's
// activation to be rejected with "licenseId, apiKey, and deviceInfo are
// required" even though every field was genuinely present. Fixed in both
// affected .mq5 sources (AT24 Gold Range Breaker v2.10, Gold Fire v5).
//
// license.releaseId is bound at issuance time and the download route
// serves private-releases/<releaseId>.ex5 directly by that id - a NEW
// ReleaseArtifact row would NOT reach the existing buyer whose license
// already points at the old releaseId. This script overwrites the SAME
// release file in place (same id, same buyer binding) with the newly
// compiled, bug-fixed binary, and updates the DB row's artifactHash to
// reflect what is now actually being served.
import "dotenv/config";
import { readFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

const HOTFIXES = [
  {
    releaseId: "cmtcqrvqq0001eotp0hbon2r5",
    ex5Path: path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m12-gold-product-01", "source", "AT24_GOLD_PDHPDL_RangeBreaker_v2.10.ex5"),
    label: "AT24 Gold Range Breaker v2.10",
  },
  {
    releaseId: "cmtcqrv4l0000eotp3bl1vaev",
    ex5Path: path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m13-gold-fire-01", "source", "GoldFire_v5.ex5"),
    label: "Gold Fire v5",
  },
];

async function main() {
  for (const fix of HOTFIXES) {
    const release = await prisma.releaseArtifact.findUnique({ where: { id: fix.releaseId } });
    if (!release) {
      console.log(`${fix.label}: SKIP - release ${fix.releaseId} not found`);
      continue;
    }
    const bytes = await readFile(fix.ex5Path);
    const newHash = createHash("sha256").update(bytes).digest("hex");
    const oldHash = release.artifactHash;

    await writeFile(path.join(RELEASES_DIR, `${release.id}.ex5`), bytes);
    await prisma.releaseArtifact.update({ where: { id: release.id }, data: { artifactHash: newHash } });

    console.log(`${fix.label}: release ${release.id} file overwritten in place. artifactHash ${oldHash} -> ${newHash}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

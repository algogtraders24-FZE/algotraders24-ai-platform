import "dotenv/config";
import { prisma } from "../lib/prisma";
async function main() {
  const releases = await prisma.releaseArtifact.findMany({
    where: { tradingSystemId: { in: ["PDHPDL-GOLD", "GOLDFIRE"] } },
    select: { id: true, tradingSystemId: true, versionId: true, platform: true, artifactVersion: true, artifactHash: true, releaseStatus: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  for (const r of releases) console.log(JSON.stringify(r));

  console.log("--- licenses referencing these releases ---");
  const releaseIds = releases.map((r) => r.id);
  const licenses = await prisma.license.findMany({
    where: { releaseId: { in: releaseIds } },
    select: { id: true, releaseId: true, tradingSystemId: true, licenseStatus: true, buyerId: true },
  });
  for (const l of licenses) console.log(JSON.stringify(l));
}
main().finally(() => prisma.$disconnect());

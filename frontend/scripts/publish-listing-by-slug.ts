// scripts/publish-listing-by-slug.ts
// Sets publicationState to PUBLISHED for one listing (from READY or DRAFT).  Usage (frontend folder):
//   npx tsx scripts/publish-listing-by-slug.ts <slug>            -> shows the state only
//   npx tsx scripts/publish-listing-by-slug.ts <slug> --apply    -> publishes
import "dotenv/config";
import { prisma } from "../lib/prisma";

async function main() {
  const slug = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!slug) throw new Error("usage: publish-listing-by-slug.ts <slug> [--apply]");
  const l = await prisma.marketplaceListing.findFirst({ where: { slug, deletedAt: null }, select: { id: true, title: true, publicationState: true, pricing: true, versionId: true, tradingSystemId: true } });
  if (!l) throw new Error(`listing not found: ${slug}`);
  const rel = l.tradingSystemId ? await prisma.releaseArtifact.count({ where: { tradingSystemId: l.tradingSystemId, releaseStatus: "PUBLISHED" } }) : 0;
  console.log(`${l.title} | ${l.publicationState} | ${JSON.stringify(l.pricing)} | published releases: ${rel}`);
  if (!apply) { console.log("(not changed - pass --apply)"); return; }
  if (rel === 0) throw new Error("no PUBLISHED release for this listing - refusing to publish");
  await prisma.marketplaceListing.update({ where: { id: l.id }, data: { publicationState: "PUBLISHED" } });
  console.log("published");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

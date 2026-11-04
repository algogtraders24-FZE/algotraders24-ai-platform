// scripts/add-demo-tested-tag-at24-indicators.ts
// Adds the "demo-tested" tag to the AT24 indicator utility listings so they show the green "Tested" label
// (isDemoTestedUtility in lib/marketplace.ts). It is NOT a Trust State; each description states what was and
// was not tested. Idempotent. Run from the frontend folder:  npx tsx scripts/add-demo-tested-tag-at24-indicators.ts
import "dotenv/config";
import { prisma } from "../lib/prisma";

async function main() {
  const rows = await prisma.marketplaceListing.findMany({
    where: { deletedAt: null, category: "Utility", slug: { startsWith: "at24-" }, trustState: null },
    select: { id: true, slug: true, tags: true, publicationState: true, tradingSystemId: true },
  });
  for (const l of rows) {
    if (!l.tradingSystemId || !l.tradingSystemId.startsWith("AT24-")) continue;
    if (l.tags.includes("demo-tested")) { console.log("already:", l.slug); continue; }
    await prisma.marketplaceListing.update({ where: { id: l.id }, data: { tags: [...l.tags, "demo-tested"] } });
    console.log("tagged:", l.slug, l.publicationState);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

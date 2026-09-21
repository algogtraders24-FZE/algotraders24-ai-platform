import "dotenv/config";
import { prisma } from "../lib/prisma";
async function main() {
  const listings = await prisma.marketplaceListing.findMany({
    where: { publicationState: { in: ["READY", "PUBLISHED"] } },
    select: { id: true, slug: true, title: true, media: true, tradingSystemId: true, platformTag: true, assetTag: true },
    orderBy: { createdAt: "asc" },
  });
  for (const l of listings) {
    const hasMedia = Array.isArray(l.media) && l.media.length > 0;
    console.log(`${hasMedia ? "HAS " : "MISS"} | ${l.slug} | ${l.title} | ${l.platformTag} | ${l.assetTag} | media=${JSON.stringify(l.media)}`);
  }
}
main().finally(() => prisma.$disconnect());

// scripts/set-listing-price.ts
// Sets the one-time USD price of a marketplace listing.  Usage (from the frontend folder):
//   npx tsx scripts/set-listing-price.ts <slug> <amountUsd>          -> shows the current price and what would change
//   npx tsx scripts/set-listing-price.ts <slug> <amountUsd> --apply  -> writes it
import "dotenv/config";
import { prisma } from "../lib/prisma";

async function main() {
  const [slug, amountArg] = process.argv.slice(2);
  const apply = process.argv.includes("--apply");
  const amount = Number(amountArg);
  if (!slug || !Number.isFinite(amount) || amount <= 0) throw new Error("usage: set-listing-price.ts <slug> <amountUsd> [--apply]");
  const l = await prisma.marketplaceListing.findFirst({ where: { slug, deletedAt: null }, select: { id: true, title: true, pricing: true, publicationState: true } });
  if (!l) throw new Error(`listing not found: ${slug}`);
  console.log(`${l.title} | ${l.publicationState} | current pricing: ${JSON.stringify(l.pricing)}`);
  const cur = (l.pricing ?? {}) as Record<string, unknown>;
  const next = { ...cur, model: "one_time", amount, currency: "USD" };
  console.log(`new pricing: ${JSON.stringify(next)}`);
  if (!apply) { console.log("(dry run - pass --apply to write)"); return; }
  await prisma.marketplaceListing.update({ where: { id: l.id }, data: { pricing: next } });
  console.log("updated");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

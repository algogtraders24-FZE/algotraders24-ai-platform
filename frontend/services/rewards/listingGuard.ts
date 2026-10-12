// services/rewards/listingGuard.ts
// (Server only.) A product that is sold as an Algo Contract can only be bought through Algo Contracts, where an active paid Pro plan
// AND a verified identity (KYC) are always checked. The ordinary marketplace checkouts call this and refuse such listings, so nobody
// can buy the same EA around the KYC check (and without the contract and rebate).
import { prisma } from "@/lib/prisma";

export const PROGRAM_LISTING_MESSAGE =
  "This product is sold as an Algo Contract. Open Algo Contracts in your dashboard to buy it (an active Pro plan and a verified identity are required).";

/** True when a reward product is bound to this listing (whether or not it is switched on yet). A missing table counts as "no". */
export async function isProgramListing(listingId: string): Promise<boolean> {
  const row = await prisma.rewardProduct.findFirst({ where: { listingId }, select: { id: true } }).catch(() => null);
  return row !== null;
}

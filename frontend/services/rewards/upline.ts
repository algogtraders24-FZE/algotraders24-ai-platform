// services/rewards/upline.ts
// (Server only.) Who is above a buyer in the referral chain. Shared by Algo Contract fulfilment and the universal referral credit.
import { prisma } from "@/lib/prisma";
import { multiLevelReferralEnabled } from "@/lib/rewards/config";
import { canEarnReferral } from "@/lib/rewards/eligibility";
import { loadUserFacts } from "@/lib/rewards/access";

/**
 * Who is above this buyer: [direct partner, the partner who referred THEM, ...] up to 4 levels, read from the attributions already
 * recorded (a partner's own referrer is whoever brought them when they bought). Stops at a loop or at the buyer. A level whose
 * partner is not Pro + verified right now is left empty, so they earn nothing but the chain above them still can.
 * Only used while REWARDS_MULTI_LEVEL is on; otherwise just the direct partner.
 */
export async function resolveUpline(directPartnerId: string, buyerId: string, at: Date): Promise<Array<string | null>> {
  const chain: string[] = [directPartnerId];
  if (multiLevelReferralEnabled()) {
    const seen = new Set<string>([buyerId, directPartnerId]);
    let cur = directPartnerId;
    while (chain.length < 4) {
      const att = await prisma.referralAttribution.findFirst({ where: { buyerId: cur }, orderBy: { createdAt: "asc" }, select: { partnerId: true } });
      if (!att || seen.has(att.partnerId)) break;
      chain.push(att.partnerId);
      seen.add(att.partnerId);
      cur = att.partnerId;
    }
  }
  const out: Array<string | null> = [];
  for (const id of chain) {
    const u = await prisma.user.findUnique({ where: { id }, select: { email: true } });
    out.push(canEarnReferral(await loadUserFacts(id, u?.email), at) ? id : null);
  }
  return out;
}


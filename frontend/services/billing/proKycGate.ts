// services/billing/proKycGate.ts
// (Server only.) The KYC check in front of buying a paid plan. See lib/billing/proKyc.ts for the rule and the rollout.
import { decideProKyc, proRequiresKyc, type ProKycDecision } from "@/lib/billing/proKyc";
import { identityProvider, isIdentityVerified } from "@/services/marketplace/identityStore";
import { isPlatformOwner } from "@/lib/marketplace/selfServe";

export async function checkProKycGate(user: { id: string; email: string | null | undefined }): Promise<ProKycDecision> {
  const required = proRequiresKyc();
  if (!required) return { allow: true, reason: "off" };
  const providerAvailable = identityProvider() !== null;
  if (!providerAvailable) console.warn("[billing] PRO_REQUIRES_KYC is on but no identity provider is configured - the rule is not enforced.");
  return decideProKyc({
    required,
    providerAvailable,
    isOwner: isPlatformOwner(user.email),
    verified: providerAvailable && !isPlatformOwner(user.email) ? await isIdentityVerified(user.id) : false,
  });
}

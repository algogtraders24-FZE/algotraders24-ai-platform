// lib/billing/proKyc.ts
// (Pure - no I/O.) "KYC to become Pro": buying (or renewing) a PAID plan needs a verified identity. Owner decision 2026-10-12: with this in
// place, everything that needs a Pro member (Algo Contracts, rebates, referral, withdrawals) automatically has a verified person behind it.
//
// Rollout (like the seller check): it only applies when PRO_REQUIRES_KYC=true AND an identity provider (Didit or Sumsub) is switched on, so
// turning the flag on before the provider exists cannot lock every buyer out. The platform owner accounts are exempt. Existing paid plans
// keep working until they run out; the rule applies to the next purchase or renewal. Admin-granted plans are not purchases and are not affected.

export function proRequiresKyc(raw: string | undefined | null = process.env.PRO_REQUIRES_KYC): boolean {
  return (raw ?? "").trim().toLowerCase() === "true";
}

export const PRO_KYC_MESSAGE =
  "Identity verification (KYC) is required before you can buy a paid plan. Verify your identity in Settings first (Identity verification), then come back to upgrade.";

export type ProKycDecision =
  | { allow: true; reason: "off" | "owner" | "no-provider" | "verified" }
  | { allow: false; message: string };

export function decideProKyc(i: { required: boolean; providerAvailable: boolean; isOwner: boolean; verified: boolean }): ProKycDecision {
  if (!i.required) return { allow: true, reason: "off" };
  if (i.isOwner) return { allow: true, reason: "owner" };
  if (!i.providerAvailable) return { allow: true, reason: "no-provider" };
  if (i.verified) return { allow: true, reason: "verified" };
  return { allow: false, message: PRO_KYC_MESSAGE };
}

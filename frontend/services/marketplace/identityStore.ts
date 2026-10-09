// services/marketplace/identityStore.ts
// Seller identity verification (Sumsub). Stores only the verdict. See lib/marketplace/identity.ts for the protocol notes.
//   getIdentity        - the seller's current state
//   startVerification  - asks Sumsub for a hosted verification link (valid 30 minutes) and marks the seller PENDING
//   applyVerdict       - writes the verdict that arrived on the signed webhook
//   sellerGate         - the ONE check every self-serve route uses: confirmed email, and (when enabled) verified identity
import { prisma } from "@/lib/prisma";
import { getSiteUrl } from "@/lib/payments/env";
import { sellerVerificationBlocker, isPlatformOwner } from "@/lib/marketplace/selfServe";
import {
  DEFAULT_LEVEL_NAME, SUMSUB_BASE_URL, identityMessage, identityRequired, signSumsubRequest, sumsubConfigured,
  type IdentityStatus, type ReviewVerdict,
} from "@/lib/marketplace/identity";

export async function getIdentity(userId: string): Promise<{ status: IdentityStatus; message: string }> {
  const row = await prisma.sellerIdentity.findUnique({ where: { userId } }).catch(() => null);
  const status = (row?.status as IdentityStatus | undefined) ?? "NONE";
  return { status, message: identityMessage(status) };
}

export type StartResult = { ok: true; url: string } | { ok: true; verified: true } | { ok: false; code: string; message: string };

export async function startVerification(user: { id: string; email: string | null | undefined }): Promise<StartResult> {
  if (!sumsubConfigured()) return { ok: false, code: "NOT_CONFIGURED", message: "Identity verification is not switched on yet." };
  const existing = await prisma.sellerIdentity.findUnique({ where: { userId: user.id } });
  if (existing?.status === "VERIFIED") return { ok: true, verified: true };
  if (existing?.status === "REJECTED") return { ok: false, code: "REJECTED", message: identityMessage("REJECTED") };

  const path = "/resources/sdkIntegrations/levels/-/websdkLink";
  const body = JSON.stringify({
    levelName: process.env.SUMSUB_LEVEL_NAME || DEFAULT_LEVEL_NAME,
    ttlInSecs: 1800,
    userId: user.id,
    ...(user.email ? { applicantIdentifiers: { email: user.email } } : {}),
    redirect: { successUrl: `${getSiteUrl().replace(/\/$/, "")}/marketplace/sell?identity=submitted` },
  });
  const ts = String(Math.floor(Date.now() / 1000));
  let res: Response;
  try {
    res = await fetch(SUMSUB_BASE_URL + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-App-Token": process.env.SUMSUB_APP_TOKEN as string,
        "X-App-Access-Ts": ts,
        "X-App-Access-Sig": signSumsubRequest(process.env.SUMSUB_SECRET_KEY as string, ts, "POST", path, body),
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, code: "PROVIDER_UNREACHABLE", message: "The verification service did not answer. Please try again in a minute." };
  }
  const json = (await res.json().catch(() => null)) as { url?: unknown } | null;
  if (!res.ok || typeof json?.url !== "string" || !json.url.startsWith("https://")) {
    return { ok: false, code: "PROVIDER_ERROR", message: "Could not start the verification. Please try again later." };
  }
  await prisma.sellerIdentity.upsert({
    where: { userId: user.id },
    create: { userId: user.id, status: "PENDING" },
    update: { status: "PENDING", rejectType: null },
  });
  return { ok: true, url: json.url };
}

export async function applyVerdict(v: ReviewVerdict): Promise<"APPLIED" | "UNKNOWN_USER" | "IGNORED"> {
  const user = await prisma.user.findUnique({ where: { id: v.userId }, select: { id: true } });
  if (!user) return "UNKNOWN_USER";
  const existing = await prisma.sellerIdentity.findUnique({ where: { userId: v.userId } });
  // A seller we never sent a link to cannot be verified by a stray event; and VERIFIED is never downgraded by a late retry.
  if (!existing) return "IGNORED";
  if (existing.status === "VERIFIED") return "IGNORED";
  const now = new Date();
  await prisma.sellerIdentity.update({
    where: { userId: v.userId },
    data: { status: v.status, rejectType: v.rejectType, applicantId: v.applicantId ?? existing.applicantId, lastEventAt: now, verifiedAt: v.status === "VERIFIED" ? now : null },
  });
  return "APPLIED";
}

export async function isIdentityVerified(userId: string): Promise<boolean> {
  const row = await prisma.sellerIdentity.findUnique({ where: { userId }, select: { status: true } }).catch(() => null);
  return row?.status === "VERIFIED";
}

/** Same set of sellers, in one query, for listing pages. */
export async function verifiedSellerIds(sellerIds: string[]): Promise<Set<string>> {
  if (sellerIds.length === 0) return new Set();
  const rows = await prisma.sellerIdentity.findMany({ where: { userId: { in: sellerIds }, status: "VERIFIED" }, select: { userId: true } }).catch(() => []);
  return new Set(rows.map((r) => r.userId));
}

/** The single check for self-serve selling. Returns a message to show when the seller may not list yet, else null. */
export async function sellerGate(profile: { id: string; email: string | null | undefined; emailVerified: boolean | null | undefined }): Promise<string | null> {
  const emailBlock = sellerVerificationBlocker({ email: profile.email, emailVerified: profile.emailVerified });
  if (emailBlock) return emailBlock;
  if (isPlatformOwner(profile.email) || !identityRequired()) return null;
  if (await isIdentityVerified(profile.id)) return null;
  return "Please verify your identity before you list a product (one-time ID check, done by our partner Sumsub). Open the Sell page and press Verify identity.";
}

// services/licensing/licenseService.ts
// Sprint M11 - DB-backed orchestration layer. This is the ONLY file that
// touches both Prisma and the server-only crypto module together - it
// wires licenseCore.ts's pure decisions to real rows, and is the thing
// API routes actually call. No business RULE lives here that isn't
// already in licenseCore.ts/licenseStateMachine.ts - this file persists
// their decisions, it doesn't make new ones.
import "server-only";
import { prisma } from "@/lib/prisma";
import { generateApiKey, hashApiKey, signLicensePayload, verifyApiKey, verifyLicenseSignature } from "./crypto";
import { decideActivation, issueLicense as coreIssueLicense, transition, validateRuntime, type ExistingActivation } from "./licenseCore";
import { getLicenseAdapter } from "./adapters";
import { recordLicenseAudit } from "./auditTrail";
import type { ActivationPolicy, LicensePayload, LicenseStatus, RevocationReason, RuntimeValidationResult } from "@/types/marketplace-license";
import { DEFAULT_ACTIVATION_POLICY } from "@/types/marketplace-license";
import type { PlatformName } from "@/types/marketplace-factory";
import { Prisma } from "@/lib/generated/prisma/client";

function isPlatformName(value: string): value is PlatformName {
  return getLicenseAdapter(value) !== null;
}

// --- Issuance (called by the Stripe webhook after a verified
// checkout.session.completed "marketplace_purchase" event - see
// app/api/webhooks/stripe/route.ts - never by an unauthenticated client).
//
// Idempotent on `providerRef` (the Stripe Checkout Session id): Stripe
// retries a webhook on any non-2xx response, so the exact same event can
// be delivered more than once. Purchase.providerRef's DB-level @unique
// constraint is the ONLY idempotency mechanism - a retried delivery finds
// the already-issued Purchase/Entitlement/License and returns it unchanged
// instead of creating a second one. Purchase+Entitlement+License are
// written in one DB transaction so a mid-write crash can never leave a
// Purchase without its Entitlement/License (which would otherwise make the
// providerRef check above insufficient on its own). ---

export interface IssueForPurchaseInput {
  buyerId: string;
  marketplaceListingId: string;
  tradingSystemId: string;
  versionId: string;
  releaseId: string;
  platform: PlatformName;
  amount: number;
  currency: string;
  // Optional - defaults to DEFAULT_ACTIVATION_POLICY (one live activation)
  // when a caller doesn't specify one, so "one per account" is the safe
  // default even before a real payment webhook exists to wire this up.
  activationPolicy?: ActivationPolicy;
  expiresAt: Date | null;
  // The payment provider that authorized this purchase (e.g. "stripe") and
  // its stable reference for this exact purchase attempt (e.g. the Stripe
  // Checkout Session id) - see Purchase.provider/providerRef in schema.prisma.
  provider: string;
  providerRef: string;
}

async function loadIssuedChain(providerRef: string) {
  return prisma.purchase.findUnique({
    where: { providerRef },
    include: { entitlements: { include: { licenses: true } } },
  });
}

function toDuplicateResult(existing: NonNullable<Awaited<ReturnType<typeof loadIssuedChain>>>, providerRef: string) {
  const entitlement = existing.entitlements[0];
  const license = entitlement?.licenses[0];
  if (!license) {
    // A Purchase exists for this providerRef but its Entitlement/License
    // never got created (should be structurally impossible now that all
    // three are written in one transaction - see issueLicenseForPurchase).
    // Refuse to silently re-issue into a state we can't explain.
    throw new Error(`Purchase for providerRef "${providerRef}" already exists without an entitlement/license - inconsistent state, refusing to silently re-issue.`);
  }
  return { license, rawApiKey: null as string | null, payload: toPayload(license), duplicate: true };
}

export async function issueLicenseForPurchase(input: IssueForPurchaseInput) {
  const existing = await loadIssuedChain(input.providerRef);
  if (existing) return toDuplicateResult(existing, input.providerRef);

  const activationPolicy = input.activationPolicy ?? DEFAULT_ACTIVATION_POLICY;
  const release = await prisma.releaseArtifact.findUnique({ where: { id: input.releaseId } });
  if (!release || release.tradingSystemId !== input.tradingSystemId || release.versionId !== input.versionId || release.platform !== input.platform) {
    throw new Error("Release does not match the requested tradingSystemId/versionId/platform.");
  }

  const now = new Date();
  const rawApiKey = generateApiKey();

  try {
    const { license, payload } = await prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.create({
        data: {
          buyerId: input.buyerId,
          marketplaceListingId: input.marketplaceListingId,
          tradingSystemId: input.tradingSystemId,
          amount: input.amount,
          currency: input.currency,
          provider: input.provider,
          providerRef: input.providerRef,
          status: "COMPLETED",
          purchasedAt: now,
        },
      });

      const entitlement = await tx.entitlement.create({
        data: {
          purchaseId: purchase.id,
          buyerId: input.buyerId,
          tradingSystemId: input.tradingSystemId,
          marketplaceListingId: input.marketplaceListingId,
          platform: input.platform,
          status: "ACTIVE",
        },
      });

      const licenseId = `lic_${purchase.id}_${now.getTime().toString(36)}`;
      const { payload, signature } = coreIssueLicense(
        {
          licenseId,
          buyerId: input.buyerId,
          tradingSystemId: input.tradingSystemId,
          versionId: input.versionId,
          releaseId: input.releaseId,
          platform: input.platform,
          activationPolicy,
          expiresAt: input.expiresAt ? input.expiresAt.toISOString() : null,
          now,
        },
        signLicensePayload,
      );

      const license = await tx.license.create({
        data: {
          id: licenseId,
          entitlementId: entitlement.id,
          buyerId: input.buyerId,
          tradingSystemId: input.tradingSystemId,
          versionId: input.versionId,
          releaseId: input.releaseId,
          platform: input.platform,
          licenseStatus: "ISSUED",
          licenseSchemaVersion: payload.licenseSchemaVersion,
          activationPolicy: activationPolicy as unknown as Prisma.InputJsonValue,
          issuedAt: now,
          expiresAt: input.expiresAt,
          signature,
          apiKeyHash: hashApiKey(rawApiKey),
        },
      });

      return { license, payload };
    });

    await recordLicenseAudit({ actorUserId: input.buyerId, action: "license.issued", licenseId: license.id, metadata: { tradingSystemId: input.tradingSystemId, platform: input.platform, provider: input.provider, result: "OK" } });

    return { license, rawApiKey: rawApiKey as string | null, payload, duplicate: false };
  } catch (err) {
    // A concurrent delivery of the same webhook event can race past the
    // loadIssuedChain() check above before either transaction commits -
    // the DB's own @unique constraint on providerRef is what actually
    // prevents the duplicate; this just turns that race into the same
    // "return the existing chain" behavior as a sequential retry.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const raced = await loadIssuedChain(input.providerRef);
      if (raced) return toDuplicateResult(raced, input.providerRef);
    }
    throw err;
  }
}

// --- Authentication helper shared by every runtime-facing endpoint ---

export type LicenseAuthResult = { ok: true; license: NonNullable<Awaited<ReturnType<typeof prisma.license.findUnique>>> } | { ok: false };

async function authenticateLicense(licenseId: string, rawApiKey: string): Promise<LicenseAuthResult> {
  const license = await prisma.license.findUnique({ where: { id: licenseId } });
  if (!license || !verifyApiKey(rawApiKey, license.apiKeyHash)) {
    return { ok: false };
  }
  return { ok: true, license };
}

// Real bug found and fixed while building the E2E verification harness
// (scripts/verify-license-e2e.ts): this function used to pass through the
// license row's CURRENT (mutable) licenseStatus. But
// licenseCore.ts's buildLicensePayload always hardcodes "ISSUED" into the
// payload that actually gets signed at issuance (the signature is a
// snapshot of the immutable facts, never re-signed on a status
// transition) - so the moment a license moved past ISSUED (i.e. the very
// first real activation, for every real buyer), toPayload() reconstructed
// a payload with licenseStatus="ACTIVE" and verifyLicenseSignature()
// correctly rejected it as tampered, since that is genuinely not what was
// signed. Every subsequent /api/license/validate call would then fail
// with SIGNATURE_INVALID forever. Live status (REVOKED/EXPIRED/etc.) is
// already checked separately and correctly via storedLicenseStatus in
// validateRuntime (licenseCore.ts) - this field only needs to match what
// was actually signed.
function toPayload(license: { id: string; buyerId: string; tradingSystemId: string; versionId: string; releaseId: string; platform: string; issuedAt: Date; expiresAt: Date | null; activationPolicy: unknown; licenseSchemaVersion: string }): LicensePayload {
  return {
    licenseId: license.id,
    buyerId: license.buyerId,
    tradingSystemId: license.tradingSystemId,
    versionId: license.versionId,
    releaseId: license.releaseId,
    platform: license.platform as PlatformName,
    issuedAt: license.issuedAt.toISOString(),
    expiresAt: license.expiresAt ? license.expiresAt.toISOString() : null,
    activationPolicy: license.activationPolicy as unknown as ActivationPolicy,
    licenseStatus: "ISSUED" as LicenseStatus,
    licenseSchemaVersion: license.licenseSchemaVersion,
  };
}

// --- Buyer-facing: reveal/regenerate the runtime API key (private
// dashboard route, browser-session-authenticated - not a /api/license/*
// runtime endpoint). The raw apiKey is only ever knowable at the instant
// issueLicenseForPurchase() creates it - after that, only its hash is
// stored (same principle as a password), so there is no "show my
// existing key" operation, only "issue me a new one and show it once."
// Rotating always invalidates the previous key immediately (only one
// apiKeyHash is ever stored per license).
export type RegenerateKeyOutcome =
  | { ok: true; rawApiKey: string }
  | { ok: false; code: "NOT_FOUND" | "FORBIDDEN" };

export async function regenerateApiKey(licenseId: string, requestingUserId: string): Promise<RegenerateKeyOutcome> {
  const license = await prisma.license.findUnique({ where: { id: licenseId } });
  if (!license) return { ok: false, code: "NOT_FOUND" };
  if (license.buyerId !== requestingUserId) return { ok: false, code: "FORBIDDEN" };

  const rawApiKey = generateApiKey();
  await prisma.license.update({ where: { id: license.id }, data: { apiKeyHash: hashApiKey(rawApiKey) } });
  await recordLicenseAudit({ actorUserId: requestingUserId, action: "license.key_regenerated", licenseId: license.id, metadata: { result: "OK" } });
  return { ok: true, rawApiKey };
}

// --- POST /api/license/activate ---

export type ActivateOutcome =
  | { ok: true; activationId: string; deviceBindingId: string; reactivated: boolean }
  | { ok: false; code: "UNAUTHORIZED" }
  | { ok: false; code: "UNKNOWN_PLATFORM" }
  | { ok: false; code: "ACTIVATION_LIMIT_EXCEEDED" | "LICENSE_NOT_USABLE"; detail: string };

export async function activateLicense(params: { licenseId: string; rawApiKey: string; rawDeviceInfo: Record<string, string>; deviceLabel: string }): Promise<ActivateOutcome> {
  const auth = await authenticateLicense(params.licenseId, params.rawApiKey);
  if (!auth.ok) return { ok: false, code: "UNAUTHORIZED" };
  const license = auth.license;

  const adapter = getLicenseAdapter(license.platform);
  if (!adapter) return { ok: false, code: "UNKNOWN_PLATFORM" };
  const deviceBindingId = adapter.deriveDeviceBindingId(params.rawDeviceInfo);

  const existingRows = await prisma.activation.findMany({ where: { licenseId: license.id } });
  const existing: ExistingActivation[] = existingRows.map((r) => ({ deviceBindingId: r.deviceBindingId, status: r.status as "ACTIVE" | "DEACTIVATED" }));

  const decision = decideActivation(license.licenseStatus as LicenseStatus, license.activationPolicy as unknown as ActivationPolicy, existing, deviceBindingId);

  if (decision.action === "REJECT") {
    await recordLicenseAudit({ actorUserId: license.buyerId, action: "license.activated", licenseId: license.id, metadata: { result: "REJECTED", reason: decision.reason, detail: decision.detail } });
    return { ok: false, code: decision.reason, detail: decision.detail };
  }

  if (decision.action === "REACTIVATE_EXISTING") {
    const row = await prisma.activation.update({
      where: { licenseId_deviceBindingId: { licenseId: license.id, deviceBindingId } },
      data: { status: "ACTIVE", deactivatedAt: null },
    });
    await recordLicenseAudit({ actorUserId: license.buyerId, action: "license.activated", licenseId: license.id, metadata: { result: "OK", reactivated: true, deviceBindingId } });
    return { ok: true, activationId: row.id, deviceBindingId, reactivated: true };
  }

  const row = await prisma.activation.create({ data: { licenseId: license.id, deviceBindingId, deviceLabel: params.deviceLabel, status: "ACTIVE" } });

  if (license.licenseStatus === "ISSUED") {
    const t = transition("ISSUED", "ACTIVATE");
    if (t.ok) await prisma.license.update({ where: { id: license.id }, data: { licenseStatus: t.next } });
  }

  await recordLicenseAudit({ actorUserId: license.buyerId, action: "license.activated", licenseId: license.id, metadata: { result: "OK", reactivated: false, deviceBindingId } });
  return { ok: true, activationId: row.id, deviceBindingId, reactivated: false };
}

// --- POST /api/license/validate ---

export async function validateLicenseRuntime(params: {
  licenseId: string;
  rawApiKey: string;
  buyerId: string;
  tradingSystemId: string;
  versionId: string;
  releaseId: string;
  platform: string;
  rawDeviceInfo: Record<string, string>;
}): Promise<RuntimeValidationResult | { ok: false; reason: "UNAUTHORIZED"; detail: string }> {
  const auth = await authenticateLicense(params.licenseId, params.rawApiKey);
  if (!auth.ok) return { ok: false, reason: "UNAUTHORIZED", detail: "Invalid licenseId/apiKey." };
  const license = auth.license;

  if (!isPlatformName(params.platform)) {
    const result: RuntimeValidationResult = { ok: false, reason: "WRONG_PLATFORM", detail: `Unknown platform "${params.platform}".` };
    await recordLicenseAudit({ actorUserId: license.buyerId, action: "license.validated", licenseId: license.id, metadata: { result: "FAIL", reason: result.reason } });
    return result;
  }

  const adapter = getLicenseAdapter(params.platform)!;
  const deviceBindingId = adapter.deriveDeviceBindingId(params.rawDeviceInfo);

  const [release, activationRow] = await Promise.all([
    prisma.releaseArtifact.findUnique({ where: { id: params.releaseId } }),
    prisma.activation.findUnique({ where: { licenseId_deviceBindingId: { licenseId: license.id, deviceBindingId } } }),
  ]);

  const result = validateRuntime(
    {
      presentedLicenseId: params.licenseId,
      presentedBuyerId: params.buyerId,
      presentedTradingSystemId: params.tradingSystemId,
      presentedVersionId: params.versionId,
      presentedReleaseId: params.releaseId,
      presentedPlatform: params.platform,
      presentedDeviceBindingId: deviceBindingId,
      now: new Date(),
      storedPayload: toPayload(license),
      storedSignature: license.signature,
      storedLicenseStatus: license.licenseStatus as LicenseStatus,
      storedActivation: activationRow ? { id: activationRow.id, deviceBindingId: activationRow.deviceBindingId, status: activationRow.status as "ACTIVE" | "DEACTIVATED" } : null,
      releaseIsValid: release?.releaseStatus === "PUBLISHED",
    },
    verifyLicenseSignature,
  );

  if (result.ok) {
    await prisma.activation.update({ where: { id: result.activationId }, data: { lastValidatedAt: new Date() } });
  }
  await recordLicenseAudit({ actorUserId: license.buyerId, action: "license.validated", licenseId: license.id, metadata: result.ok ? { result: "OK" } : { result: "FAIL", reason: result.reason } });

  return result;
}

// --- POST /api/license/deactivate (idempotent - deactivating an already-
// deactivated or nonexistent device binding is a safe no-op, not an error,
// since the caller's desired end-state is already true). ---

export async function deactivateLicense(params: { licenseId: string; rawApiKey: string; rawDeviceInfo: Record<string, string> }): Promise<{ ok: true } | { ok: false; code: "UNAUTHORIZED" | "UNKNOWN_PLATFORM" }> {
  const auth = await authenticateLicense(params.licenseId, params.rawApiKey);
  if (!auth.ok) return { ok: false, code: "UNAUTHORIZED" };
  const license = auth.license;

  const adapter = getLicenseAdapter(license.platform);
  if (!adapter) return { ok: false, code: "UNKNOWN_PLATFORM" };
  const deviceBindingId = adapter.deriveDeviceBindingId(params.rawDeviceInfo);

  await prisma.activation.updateMany({
    where: { licenseId: license.id, deviceBindingId, status: "ACTIVE" },
    data: { status: "DEACTIVATED", deactivatedAt: new Date() },
  });

  await recordLicenseAudit({ actorUserId: license.buyerId, action: "license.deactivated", licenseId: license.id, metadata: { result: "OK", deviceBindingId } });
  return { ok: true };
}

// --- GET /api/license/status ---

export async function getLicenseStatus(params: { licenseId: string; rawApiKey: string }) {
  const auth = await authenticateLicense(params.licenseId, params.rawApiKey);
  if (!auth.ok) return { ok: false as const, code: "UNAUTHORIZED" as const };
  const license = auth.license;

  const activations = await prisma.activation.findMany({ where: { licenseId: license.id } });
  const activeCount = activations.filter((a) => a.status === "ACTIVE").length;
  const policy = license.activationPolicy as unknown as ActivationPolicy;

  return {
    ok: true as const,
    licenseId: license.id,
    licenseStatus: license.licenseStatus,
    issuedAt: license.issuedAt.toISOString(),
    expiresAt: license.expiresAt?.toISOString() ?? null,
    activationsUsed: activeCount,
    activationsAllowed: policy.maxActivations,
    revokedAt: license.revokedAt?.toISOString() ?? null,
    revokedReason: license.revokedReason,
  };
}

// --- Revocation (internal/admin - Section 15; not one of the four
// buyer-facing endpoints, but the required revocation architecture) ---

export async function revokeLicense(params: { licenseId: string; reason: RevocationReason; detail: string; actorUserId: string }) {
  const license = await prisma.license.findUnique({ where: { id: params.licenseId } });
  if (!license) return { ok: false as const, code: "NOT_FOUND" as const };

  const t = transition(license.licenseStatus as LicenseStatus, "REVOKE");
  if (!t.ok) return { ok: false as const, code: "INVALID_TRANSITION" as const, detail: t.reason };

  await prisma.license.update({
    where: { id: license.id },
    data: { licenseStatus: t.next, revokedAt: new Date(), revokedReason: `${params.reason}: ${params.detail}` },
  });
  await recordLicenseAudit({ actorUserId: params.actorUserId, action: "license.revoked", licenseId: license.id, metadata: { result: "OK", reason: params.reason, detail: params.detail } });
  return { ok: true as const };
}

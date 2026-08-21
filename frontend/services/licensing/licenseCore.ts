// services/licensing/licenseCore.ts
// Sprint M11 - Platform-agnostic License core (brief section 10). Zero
// platform-specific branches, zero direct Prisma/DB access, zero direct
// import of crypto.ts's server-only signing module - every capability that
// could vary (signing, verification, "now") is INJECTED as a plain
// function argument. This is what makes the core:
//   (a) provably platform-neutral - the same functions run identically
//       whether the caller is an MT5Adapter or an AIEngineAdapter (Test U),
//   (b) testable end-to-end from a plain script (no "server-only"/DB
//       import chain to work around, unlike crypto.ts itself),
//   (c) the ONLY place license business rules are decided - adapters and
//       the DB-backed licenseService.ts both call into this, never
//       reimplement a rule locally.
import { canTransition, isTerminal, isUsable, transition, type LicenseEvent } from "./licenseStateMachine";
import type { ActivationPolicy, LicensePayload, LicenseStatus, RuntimeValidationResult } from "@/types/marketplace-license";

export type Signer = (payload: LicensePayload) => string;
export type Verifier = (payload: LicensePayload, signature: string) => boolean;

export interface IssueLicenseInput {
  licenseId: string;
  buyerId: string;
  tradingSystemId: string;
  versionId: string;
  releaseId: string;
  platform: LicensePayload["platform"];
  activationPolicy: ActivationPolicy;
  expiresAt: string | null;
  now: Date;
}

export function buildLicensePayload(input: IssueLicenseInput): LicensePayload {
  return {
    licenseId: input.licenseId,
    buyerId: input.buyerId,
    tradingSystemId: input.tradingSystemId,
    versionId: input.versionId,
    releaseId: input.releaseId,
    platform: input.platform,
    issuedAt: input.now.toISOString(),
    expiresAt: input.expiresAt,
    activationPolicy: input.activationPolicy,
    licenseStatus: "ISSUED",
    licenseSchemaVersion: "M11-license-v1",
  };
}

export function issueLicense(input: IssueLicenseInput, sign: Signer): { payload: LicensePayload; signature: string } {
  const payload = buildLicensePayload(input);
  return { payload, signature: sign(payload) };
}

// --- Activation decision (pure - no DB write here; the caller persists) ---

export interface ExistingActivation {
  deviceBindingId: string;
  status: "ACTIVE" | "DEACTIVATED";
}

export type ActivateDecision =
  | { action: "CREATE" }
  | { action: "REACTIVATE_EXISTING"; deviceBindingId: string } // idempotent re-activation of the SAME device (Test K/L)
  | { action: "REJECT"; reason: "ACTIVATION_LIMIT_EXCEEDED" | "LICENSE_NOT_USABLE"; detail: string };

export function decideActivation(
  licenseStatus: LicenseStatus,
  activationPolicy: ActivationPolicy,
  existingActivations: ExistingActivation[],
  requestingDeviceBindingId: string,
): ActivateDecision {
  // A license may activate from ISSUED (first ever activation, which is
  // itself the ISSUED->ACTIVE transition) or from ACTIVE (adding another
  // device up to the policy limit). Anything else fails closed.
  if (licenseStatus !== "ISSUED" && licenseStatus !== "ACTIVE") {
    return { action: "REJECT", reason: "LICENSE_NOT_USABLE", detail: `License is ${licenseStatus}, not ISSUED or ACTIVE.` };
  }

  const existing = existingActivations.find((a) => a.deviceBindingId === requestingDeviceBindingId);
  if (existing) {
    // Same device, same license, requested again - idempotent, never a
    // second row, never counted twice against the activation limit.
    return { action: "REACTIVATE_EXISTING", deviceBindingId: existing.deviceBindingId };
  }

  const activeCount = existingActivations.filter((a) => a.status === "ACTIVE").length;
  if (activeCount >= activationPolicy.maxActivations) {
    return { action: "REJECT", reason: "ACTIVATION_LIMIT_EXCEEDED", detail: `${activeCount}/${activationPolicy.maxActivations} activations already in use.` };
  }

  return { action: "CREATE" };
}

// --- Runtime validation (pure) ---

export interface RuntimeValidationInput {
  presentedLicenseId: string;
  presentedBuyerId: string;
  presentedTradingSystemId: string;
  presentedVersionId: string;
  presentedReleaseId: string;
  presentedPlatform: LicensePayload["platform"];
  presentedDeviceBindingId: string;
  now: Date;

  // What the server actually has on record - this function never trusts
  // the caller's own claims, only compares them against these.
  storedPayload: LicensePayload | null; // null = license genuinely not found
  storedSignature: string | null;
  storedLicenseStatus: LicenseStatus | null;
  storedActivation: ExistingActivation & { id: string } | null; // this device's activation row, if any
  releaseIsValid: boolean; // ReleaseArtifact.releaseStatus is PUBLISHED (not REVOKED/DRAFT/DEPRECATED)
}

export function validateRuntime(input: RuntimeValidationInput, verify: Verifier): RuntimeValidationResult {
  if (!input.storedPayload || !input.storedSignature || !input.storedLicenseStatus) {
    return { ok: false, reason: "LICENSE_NOT_FOUND", detail: `No license found for id ${input.presentedLicenseId}.` };
  }

  // Tamper check FIRST - a forged/altered payload must never reach the
  // field-by-field comparisons below (section 17: modified license payload).
  if (!verify(input.storedPayload, input.storedSignature)) {
    return { ok: false, reason: "SIGNATURE_INVALID", detail: "License signature does not verify against the stored payload." };
  }

  const p = input.storedPayload;
  if (p.buyerId !== input.presentedBuyerId) {
    return { ok: false, reason: "WRONG_BUYER", detail: "Presented buyerId does not match the license." };
  }
  if (p.tradingSystemId !== input.presentedTradingSystemId) {
    return { ok: false, reason: "WRONG_PRODUCT", detail: "Presented tradingSystemId does not match the license (cross-product reuse)." };
  }
  if (p.versionId !== input.presentedVersionId) {
    return { ok: false, reason: "WRONG_VERSION", detail: "Presented versionId does not match the license (cross-version reuse)." };
  }
  if (p.releaseId !== input.presentedReleaseId) {
    return { ok: false, reason: "WRONG_RELEASE", detail: "Presented releaseId does not match the license." };
  }
  if (p.platform !== input.presentedPlatform) {
    return { ok: false, reason: "WRONG_PLATFORM", detail: "Presented platform does not match the license." };
  }
  if (!input.releaseIsValid) {
    return { ok: false, reason: "RELEASE_NOT_VALID", detail: "The release this license points to is not PUBLISHED (revoked/deprecated/draft)." };
  }
  if (input.storedLicenseStatus === "REVOKED") {
    return { ok: false, reason: "LICENSE_REVOKED", detail: "License has been revoked." };
  }
  if (input.storedLicenseStatus === "EXPIRED" || (p.expiresAt && new Date(p.expiresAt) <= input.now)) {
    return { ok: false, reason: "LICENSE_EXPIRED", detail: "License has expired." };
  }
  if (!isUsable(input.storedLicenseStatus)) {
    return { ok: false, reason: "LICENSE_NOT_ACTIVE", detail: `License status is ${input.storedLicenseStatus}, not ACTIVE.` };
  }
  if (!input.storedActivation || input.storedActivation.status !== "ACTIVE") {
    return { ok: false, reason: "ACTIVATION_NOT_FOUND", detail: `No ACTIVE activation for device ${input.presentedDeviceBindingId}.` };
  }

  return { ok: true, licenseId: p.licenseId, activationId: input.storedActivation.id };
}

export { canTransition, isTerminal, isUsable, transition };
export type { LicenseEvent };

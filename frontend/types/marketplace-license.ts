// types/marketplace-license.ts
// Sprint M11 - License & Product Protection Architecture types.
// See ea-research/marketplace-research/m11-license-architecture/
// M11_architecture.md for the full design. License/Entitlement/Activation
// are kept structurally distinct from TrustState/EligibilityResult
// (types/marketplace.ts, types/marketplace-factory.ts) on purpose -
// License answers "is this buyer authorized," never "is this product
// trustworthy" or "is AT24 allowing this sale" (M11 brief section 1).
//
// NAMED "marketplace-license.ts", not "license.ts", on purpose: a
// pre-existing, UNRELATED `types/license.ts` already exists for the
// legacy /products demo catalog's mock "My Licenses" dashboard page
// (data/licenses.ts's hardcoded LICENSES array, services/license.service.ts,
// app/dashboard/licenses/) - a completely different, mock-data-only
// concept (lowercase status strings, Customer/Product-shaped, no real DB
// table, no signing, no activation limits enforcement) that this sprint
// discovered while building M11 (see M11_architecture.md section 2 for
// the full account of this collision and why it was NOT merged/resolved
// here). This file is the real, DB-backed, cryptographically-signed
// architecture; that one is untouched, unrelated demo UI support code.

import type { PlatformName } from "./marketplace-factory";

export const LICENSE_STATUSES = ["ISSUED", "ACTIVE", "SUSPENDED", "REVOKED", "EXPIRED"] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

export const ACTIVATION_STATUSES = ["ACTIVE", "DEACTIVATED"] as const;
export type ActivationStatus = (typeof ACTIVATION_STATUSES)[number];

export const RELEASE_STATUSES = ["DRAFT", "PUBLISHED", "DEPRECATED", "REVOKED"] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

export const ENTITLEMENT_STATUSES = ["ACTIVE", "REVOKED"] as const;
export type EntitlementStatus = (typeof ENTITLEMENT_STATUSES)[number];

export const PURCHASE_STATUSES = ["PENDING", "COMPLETED", "REFUNDED", "REVERSED"] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export const LICENSE_SCHEMA_VERSION = "M11-license-v1";

export interface ActivationPolicy {
  maxActivations: number;
}

// Default policy for a newly issued license: one live activation at a
// time, matching how MQL5 Market and similar marketplaces license a
// product per account, not per purchase-and-share-freely. A future
// payment-webhook caller of issueLicenseForPurchase can still override
// this (e.g. a multi-seat Enterprise plan), but this is the safe default
// when nothing else is specified.
export const DEFAULT_ACTIVATION_POLICY: ActivationPolicy = { maxActivations: 1 };

// The exact, canonical set of fields that get signed (services/licensing/
// crypto.ts's canonicalize() is the single source of truth for byte-exact
// serialization - this interface is the field list, not the wire format).
export interface LicensePayload {
  licenseId: string;
  buyerId: string;
  tradingSystemId: string;
  versionId: string;
  releaseId: string;
  platform: PlatformName;
  issuedAt: string; // ISO
  expiresAt: string | null; // ISO or null (no expiry)
  activationPolicy: ActivationPolicy;
  licenseStatus: LicenseStatus;
  licenseSchemaVersion: string;
}

export interface SignedLicense {
  payload: LicensePayload;
  signature: string; // base64
}

// Reasons RuntimeValidation can fail closed with - always one specific
// named reason, never a generic "invalid" (M11 brief section 9).
export const RUNTIME_VALIDATION_FAILURES = [
  "LICENSE_NOT_FOUND",
  "WRONG_BUYER",
  "WRONG_PRODUCT",
  "WRONG_VERSION",
  "WRONG_RELEASE",
  "WRONG_PLATFORM",
  "LICENSE_NOT_ACTIVE",
  "LICENSE_EXPIRED",
  "LICENSE_REVOKED",
  "RELEASE_NOT_VALID",
  "ACTIVATION_NOT_FOUND",
  "ACTIVATION_LIMIT_EXCEEDED",
  "SIGNATURE_INVALID",
] as const;
export type RuntimeValidationFailure = (typeof RUNTIME_VALIDATION_FAILURES)[number];

export type RuntimeValidationResult =
  | { ok: true; licenseId: string; activationId: string }
  | { ok: false; reason: RuntimeValidationFailure; detail: string };

// Revocation reasons (M11 brief section 15) - a closed, named set, never
// free text alone (detail carries the free-text context).
export const REVOCATION_REASONS = [
  "PAYMENT_REVERSAL",
  "FRAUD",
  "ACCOUNT_TERMINATION",
  "SECURITY_INCIDENT",
  "COMPROMISED_RELEASE",
  "ADMINISTRATIVE_ACTION",
] as const;
export type RevocationReason = (typeof REVOCATION_REASONS)[number];

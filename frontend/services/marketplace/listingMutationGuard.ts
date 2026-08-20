// services/marketplace/listingMutationGuard.ts
// Sprint M8 - Pure seller/AT24 field-authorization logic, extracted from
// app/api/private/marketplace/listings/[id]/route.ts so the REAL
// authorization decision can be unit-tested directly (scripts/validate-
// marketplace-platform.ts) without needing a live authenticated session -
// the route imports and uses this exact function, it is not a
// reimplementation for testing purposes.
import type { Prisma } from "@/lib/generated/prisma/client";

export const SELLER_MUTABLE_FIELDS = ["title", "description", "media", "pricing", "category", "platformTag", "assetTag", "tags"] as const;
export type SellerMutableField = (typeof SELLER_MUTABLE_FIELDS)[number];

// Evidence, Validation, RiskAnalysis, History, and Trust State fields are
// never settable by a seller through the listing-mutation endpoint - for
// ANY caller, including the owner. Populated only by a future AT24-internal
// ingestion process (out of scope this sprint).
export const AT24_ONLY_FIELDS = [
  "trustState",
  "trustReasonCode",
  "trustExplanation",
  "trustStatusId",
  "evidenceId",
  "evidenceHash",
  "validationId",
  "validationHash",
  "riskAnalysisId",
  "riskAnalysisHash",
  "tradingSystemId",
  "versionId",
  "lastEvidenceAt",
  "publicationState",
  "sellerId",
  "id",
  "slug",
] as const;

export function isSellerMutableField(key: string): key is SellerMutableField {
  return (SELLER_MUTABLE_FIELDS as readonly string[]).includes(key);
}

// A properly-typed shape Prisma's `MarketplaceListing.update` data actually
// accepts - not `unknown`. Every field optional (PATCH is partial-update).
export interface SellerListingUpdateData {
  title?: string;
  description?: string;
  media?: string[];
  pricing?: Prisma.InputJsonValue;
  category?: string;
  platformTag?: string;
  assetTag?: string;
  tags?: string[];
}

const STRING_FIELDS = ["title", "description", "category", "platformTag", "assetTag"] as const;
const STRING_ARRAY_FIELDS = ["media", "tags"] as const;

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

export type MutationGuardResult =
  | { ok: true; data: SellerListingUpdateData }
  | { ok: false; reason: "FORBIDDEN_FIELD"; fields: string[] }
  | { ok: false; reason: "UNKNOWN_FIELD"; fields: string[] }
  | { ok: false; reason: "INVALID_FIELD_TYPE"; fields: string[] };

// The actual authorization decision: given a raw PATCH body, either return
// the safe, correctly-typed seller-owned subset to write, or a typed
// rejection. Explicit reject, never a silent strip or a silent type
// coercion - an attempt to set an AT24-only field, an unknown field, or a
// wrong-typed value is a client integration bug (or a probing attack) that
// deserves a loud rejection, not a quietly-ignored no-op.
export function evaluateListingMutation(body: Record<string, unknown>): MutationGuardResult {
  const forbiddenKeysPresent = Object.keys(body).filter((k) => (AT24_ONLY_FIELDS as readonly string[]).includes(k));
  if (forbiddenKeysPresent.length > 0) {
    return { ok: false, reason: "FORBIDDEN_FIELD", fields: forbiddenKeysPresent };
  }

  const unknownKeys = Object.keys(body).filter((k) => !isSellerMutableField(k));
  if (unknownKeys.length > 0) {
    return { ok: false, reason: "UNKNOWN_FIELD", fields: unknownKeys };
  }

  const invalidTypeFields: string[] = [];
  const data: SellerListingUpdateData = {};

  for (const key of STRING_FIELDS) {
    if (key in body) {
      const v = body[key];
      if (typeof v !== "string") invalidTypeFields.push(key);
      else data[key] = v;
    }
  }
  for (const key of STRING_ARRAY_FIELDS) {
    if (key in body) {
      const v = body[key];
      if (!isStringArray(v)) invalidTypeFields.push(key);
      else data[key] = v;
    }
  }
  if ("pricing" in body) {
    const v = body.pricing;
    if (typeof v !== "object" || v === null || Array.isArray(v)) invalidTypeFields.push("pricing");
    else data.pricing = v as Prisma.InputJsonValue;
  }

  if (invalidTypeFields.length > 0) {
    return { ok: false, reason: "INVALID_FIELD_TYPE", fields: invalidTypeFields };
  }

  return { ok: true, data };
}

// services/publishing/content-hash.ts
// AT24 Publishing Contract - the ONE runtime helper the contract needs
// (Sprint P2.1 §10).
//
// The Publishing Contract (types/publishing/) is pure and declarative. It
// defines WHICH fields make up a content version and in WHAT order
// (canonicalContentBasis). This file applies the digest to that basis - the
// only line of "behavior" in P2.1.
//
// Algorithm (LOCKED as PUB-v1, see publish-input-contract.ts):
//   contentHash = sha256_hex( utf8( canonicalContentBasis(content) ) )
//
// sha256 + hex chosen to match every other content-identity hash in this
// repo (services/news/normalize.service.ts, services/calendar/
// normalize.service.ts, services/licensing/adapters.ts,
// services/quant-lite/backend/requestHash.ts). No secret participates in the
// basis, so the digest is safe to log and to expose as an idempotency key.
//
// Not marked `server-only`: it is a pure function with no I/O and is
// exercised directly by scripts/validate-publishing-contract.ts under tsx.

import { createHash } from "node:crypto";
import {
  canonicalContentBasis,
  type PublishableContent,
  type NormalizedPublishInput,
} from "@/types/publishing";

/** sha256 hex digest of the canonical content basis. Deterministic. */
export function computeContentHash(content: PublishableContent): string {
  return createHash("sha256").update(canonicalContentBasis(content), "utf8").digest("hex");
}

/** Build a full NormalizedPublishInput from its parts, computing the hash. The
 *  Publishing Service uses this when it projects an Article into a publish
 *  input; an adapter never calls it (it is handed the finished input). */
export function buildNormalizedPublishInput(
  parts: Omit<NormalizedPublishInput, "contentHash">,
): NormalizedPublishInput {
  return { ...parts, contentHash: computeContentHash(parts) };
}

/** True iff `input.contentHash` matches a fresh digest of its own content
 *  fields. The integrity check the adapter boundary can assert cheaply. */
export function contentHashMatches(input: NormalizedPublishInput): boolean {
  return input.contentHash === computeContentHash(input);
}

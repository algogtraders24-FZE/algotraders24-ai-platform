// types/publishing/publish-input-contract.ts
// AT24 Publishing Contract - Normalized publish input + content hashing
// (Sprint P2.1 §9, §10).
//
// The NormalizedPublishInput is the ONLY thing a DestinationAdapter receives.
// It is a projection of an existing Article (+ its SEO metadata) into exactly
// the fields a destination needs. It carries NO Prisma row, NO HTTP request,
// NO session, NO React state (Sprint P2.1 §8).
//
// Article data is NOT duplicated into a new table by this contract. The
// normalized input is assembled on demand by the Publishing Service from the
// live Article; only the derived `contentHash` (and the job/attempt rows) are
// persisted in a later sub-sprint (Sprint P2.1 §9, §19).

import {
  type ContractViolation,
  type ContractValidationResult,
  contractResult,
  isNonEmptyString,
  isSha256Hex,
  isSlug,
} from "./common";
import { isPublishingDestinationId, type PublishingDestinationId } from "./destination-contract";

/** The SEO subset a destination actually needs. A projection of
 *  types/seo-metadata.ts#SeoMetadata - not a copy of it. `score` and the
 *  OpenGraph/Twitter blocks are AT24-internal and deliberately excluded. */
export interface NormalizedPublishSeo {
  metaDescription: string;
  keywords: string[];
}

/**
 * The fields that DEFINE a published content version. These, and ONLY these,
 * participate in `contentHash` (Sprint P2.1 §10), in this exact order.
 *
 * NOT in the hash:
 *  - `articleId`   - SOURCE identity, stable across every edit (§9)
 *  - `destination` - a separate axis of the publication identity (§11)
 *  - `contentHash` - the output itself
 */
export const CONTENT_HASH_FIELDS = [
  "title",
  "slug",
  "body",
  "excerpt",
  "canonicalUrl",
  "disclaimer",
  "seo.metaDescription",
  "seo.keywords",
] as const;

/** Just the content-version-defining fields - no identity, no hash. */
export interface PublishableContent {
  /** Article title as it will appear at the destination. */
  title: string;
  /** URL slug (lowercase-hyphen). The same value the Article already stores. */
  slug: string;
  /** The publishable article body. Task §9 calls this "content"; named `body`
   *  here so "content" stays available for the concept, not one field. The
   *  Publishing Service serializes Article.sections[] into this string
   *  deterministically (that serializer is defined in P2.2, not P2.1). */
  body: string;
  /** Short summary / excerpt. Sourced from Article.summary. */
  excerpt: string;
  /** Canonical URL for the published piece. From Article.seo.canonicalUrl. */
  canonicalUrl: string;
  /** The compliance disclaimer carried on the Article. */
  disclaimer: string;
  seo: NormalizedPublishSeo;
}

/** What a DestinationAdapter receives: the content, its source identity, its
 *  destination, and the already-computed content hash (the adapter never
 *  recomputes it). */
export interface NormalizedPublishInput extends PublishableContent {
  /** SOURCE identity - which Article this came from. Never changes for a
   *  given Article, regardless of how many times its content is revised. */
  articleId: string;
  /** Where this is being published. */
  destination: PublishingDestinationId;
  /** sha256 hex of `canonicalContentBasis(this)`. Deterministic; changes iff
   *  a CONTENT_HASH_FIELDS value changes. */
  contentHash: string;
}

// ASCII Unit Separator (U+001F). Chosen because it never occurs in article
// prose, so `a=x<US>b=y` can never be forged by content that contains the
// joiner. Kept as an escape, not a literal, so the source stays greppable.
const UNIT_SEP = String.fromCharCode(0x1f);

/**
 * The deterministic string the content hash is computed over. PURE - same
 * input, same output, on any machine, forever.
 *
 * Algorithm (LOCKED as PUB-v1):
 *   basis = join(U+001F, [
 *     "title="        + title,
 *     "slug="         + slug,
 *     "body="         + body,
 *     "excerpt="      + excerpt,
 *     "canonicalUrl=" + canonicalUrl,
 *     "disclaimer="   + disclaimer,
 *     "seo.metaDescription=" + seo.metaDescription,
 *     "seo.keywords=" + seo.keywords.join(","),   // order preserved (SEO-significant)
 *   ])
 *   contentHash = sha256_hex(utf8(basis))         // digest applied in services/publishing/content-hash.ts
 *
 * Whitespace is NOT normalized: a trailing-space edit is a real content
 * change and SHOULD produce a new hash. Field labels are included so a value
 * moving from one field to another also changes the hash.
 */
export function canonicalContentBasis(content: PublishableContent): string {
  return [
    `title=${content.title}`,
    `slug=${content.slug}`,
    `body=${content.body}`,
    `excerpt=${content.excerpt}`,
    `canonicalUrl=${content.canonicalUrl}`,
    `disclaimer=${content.disclaimer}`,
    `seo.metaDescription=${content.seo.metaDescription}`,
    `seo.keywords=${content.seo.keywords.join(",")}`,
  ].join(UNIT_SEP);
}

export function isNormalizedPublishSeo(value: unknown): value is NormalizedPublishSeo {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.metaDescription === "string" &&
    Array.isArray(s.keywords) &&
    s.keywords.every((k) => typeof k === "string")
  );
}

/** Shape check for the content-only fields (no identity, no hash). */
export function isPublishableContent(value: unknown): value is PublishableContent {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return (
    isNonEmptyString(c.title) &&
    isSlug(c.slug) &&
    typeof c.body === "string" &&
    typeof c.excerpt === "string" &&
    isNonEmptyString(c.canonicalUrl) &&
    typeof c.disclaimer === "string" &&
    isNormalizedPublishSeo(c.seo)
  );
}

export function isNormalizedPublishInput(value: unknown): value is NormalizedPublishInput {
  if (!isPublishableContent(value)) return false;
  const i = value as unknown as Record<string, unknown>;
  return (
    isNonEmptyString(i.articleId) &&
    isPublishingDestinationId(i.destination) &&
    isSha256Hex(i.contentHash)
  );
}

/**
 * Full contract validation for a NormalizedPublishInput. Note this does NOT
 * verify that `contentHash` actually matches `canonicalContentBasis` - that
 * check needs the digest function and lives in
 * services/publishing/content-hash.ts#assertContentHashMatches. This is a
 * shape + required-field gate only.
 */
export function validateNormalizedPublishInput(value: unknown): ContractValidationResult {
  const v: ContractViolation[] = [];
  if (!value || typeof value !== "object") {
    return contractResult([{ path: "", message: "NormalizedPublishInput must be an object." }]);
  }
  const i = value as Record<string, unknown>;
  if (!isNonEmptyString(i.articleId)) v.push({ path: "articleId", message: "articleId is required." });
  if (!isPublishingDestinationId(i.destination)) {
    v.push({ path: "destination", message: "destination must be a known PublishingDestinationId." });
  }
  if (!isNonEmptyString(i.title)) v.push({ path: "title", message: "title is required." });
  if (!isSlug(i.slug)) v.push({ path: "slug", message: "slug must be lowercase-hyphen." });
  if (typeof i.body !== "string" || i.body.trim().length === 0) {
    v.push({ path: "body", message: "body is required and must be non-empty." });
  }
  if (typeof i.excerpt !== "string") v.push({ path: "excerpt", message: "excerpt must be a string." });
  if (!isNonEmptyString(i.canonicalUrl)) v.push({ path: "canonicalUrl", message: "canonicalUrl is required." });
  if (typeof i.disclaimer !== "string") v.push({ path: "disclaimer", message: "disclaimer must be a string." });
  if (!isNormalizedPublishSeo(i.seo)) v.push({ path: "seo", message: "seo must be { metaDescription, keywords[] }." });
  if (!isSha256Hex(i.contentHash)) {
    v.push({ path: "contentHash", message: "contentHash must be a 64-char lowercase sha256 hex string." });
  }
  return contractResult(v);
}

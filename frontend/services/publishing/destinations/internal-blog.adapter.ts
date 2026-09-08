// services/publishing/destinations/internal-blog.adapter.ts
// AT24 Publishing Engine (P2.2) - the first real DestinationAdapter.
//
// INTERNAL_BLOG = AT24's own blog surface. This adapter is the GATE for what
// is allowed onto it. It has NO external provider, NO credentials, and (in
// P2.2) NO reader - the `/blog` route is P2.5. `publish()` therefore does
// not "post" anywhere: it enforces the blog's content rules and returns the
// on-site canonical URL as the confirmed result. When P2.5 lands, the
// "make it visible" step is added HERE without changing the contract.
//
// Contract boundaries held (Sprint P2.1 §8, §16):
//   - imports nothing from React / Next request context / Prisma / cron /
//     Automation / the Agent Framework
//   - performs NO authorization (the Publishing Service already checked the
//     caller owns the Article before building the NormalizedPublishInput)
//   - reads/writes NO job or attempt rows
//   - does NOT compute or re-verify contentHash (it is handed one)
//   - reports failure ONLY as a typed PublishError

import {
  makePublishError,
  type AdapterValidationResult,
  type DestinationAdapter,
  type NormalizedPublishInput,
  type PublishError,
  type PublishResult,
} from "@/types/publishing";

/** The one place the blog's canonical origin is defined. Mirrors the URL
 *  services/ai/publishing/seo.service.ts already builds for an Article. */
const BLOG_ORIGIN = "https://algotraders24.ai";
const BLOG_PATH_PREFIX = "/blog/";

/** Minimum real body length for something to count as a publishable article
 *  rather than an empty skeleton. Matches the spirit of
 *  article-validator.service.ts (>= 3 sections) without duplicating it. */
const MIN_BODY_CHARS = 80;

function expectedCanonicalUrl(slug: string): string {
  return `${BLOG_ORIGIN}${BLOG_PATH_PREFIX}${slug}`;
}

export class InternalBlogAdapter implements DestinationAdapter {
  readonly destination = "INTERNAL_BLOG" as const;

  async validate(input: NormalizedPublishInput): Promise<AdapterValidationResult> {
    const errors: PublishError[] = [];
    const fail = (message: string) =>
      errors.push(makePublishError("VALIDATION_ERROR", message, { destination: this.destination }));

    if (input.destination !== this.destination) {
      fail(`input.destination "${input.destination}" is not INTERNAL_BLOG`);
    }
    if (input.title.trim().length === 0) fail("title is required");
    if (input.slug.trim().length === 0) fail("slug is required");
    if (input.body.trim().length < MIN_BODY_CHARS) {
      fail(`body is too short to publish (min ${MIN_BODY_CHARS} characters of content)`);
    }
    if (input.excerpt.trim().length === 0) fail("excerpt is required for a blog listing");
    // AT24 compliance: every published market-research piece carries the
    // disclaimer (mirrors article-validator.service.ts).
    if (input.disclaimer.trim().length === 0) fail("disclaimer is required");
    if (input.seo.metaDescription.trim().length === 0) fail("seo.metaDescription is required");

    // INTERNAL_BLOG only ever publishes to our own domain, at the slug-derived
    // path. A mismatch means the projection is inconsistent - reject rather
    // than publish something whose canonical URL will 404 or point offsite.
    if (input.canonicalUrl !== expectedCanonicalUrl(input.slug)) {
      fail(
        `canonicalUrl "${input.canonicalUrl}" must equal "${expectedCanonicalUrl(input.slug)}" for INTERNAL_BLOG`,
      );
    }

    // Stored-XSS guard (P1 audit, Security finding #3): the body is authored
    // content that a future /blog reader will render. Reject raw <script>.
    if (/<\s*script/i.test(input.body)) fail("body must not contain a raw <script> tag");

    return { valid: errors.length === 0, errors };
  }

  async publish(input: NormalizedPublishInput): Promise<PublishResult> {
    const pre = await this.validate(input);
    if (!pre.valid) {
      // Surface the first concrete reason; the full list is on `pre.errors`.
      const first = pre.errors[0];
      throw makePublishError(
        "VALIDATION_ERROR",
        first ? first.message : "content is not valid for INTERNAL_BLOG",
        { destination: this.destination },
      );
    }

    // P2.2: no reader, no external post. The publication IS the confirmed
    // job/attempt the Publishing Service persists around this result. We
    // return the on-site canonical URL as the public location and NO
    // external id (INTERNAL_BLOG issues none - never fabricated).
    return {
      success: true,
      destination: this.destination,
      externalReference: null,
      externalUrl: input.canonicalUrl,
      publishedAt: new Date().toISOString(),
    };
  }
}

export const internalBlogAdapter = new InternalBlogAdapter();

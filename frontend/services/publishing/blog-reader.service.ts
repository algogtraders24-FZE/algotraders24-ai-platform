// services/publishing/blog-reader.service.ts
// AT24 Publishing Engine (P2.5) - the PUBLIC read model behind /blog and
// /blog/[slug].
//
// LOCKED RULE: an Article is visible on /blog iff it has a SUCCEEDED
// PublishingJob for destination INTERNAL_BLOG (enforced by the source query),
// AND its current content still hashes to that job's `contentHash` (enforced
// here). Visibility is NEVER decided by `Article.status` - that is exactly
// the drift P2.3 removed. A legacy `articleService.publish()` that flips
// `Article.status` without a job produces NOTHING visible here.
//
// Content is sanitized to plain text before it reaches a page (defence in
// depth on top of React's default escaping and the adapter's write-path
// <script> reject).
//
// Ownership-independent (public). The source is injectable so the service is
// testable without a database.

import { publishingRepository } from "./publishing.repository";
import { serializeArticleBody } from "./article-serializer";
import { computeContentHash } from "./content-hash";
import { toSafeInline, toSafePlainText } from "@/lib/publishing/sanitize-text";
import type {
  BlogPost,
  BlogPostSeo,
  BlogPostSummary,
  PublishableContent,
  PublishedInternalBlogRecord,
} from "@/types/publishing";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://algotraders24.ai";

/** The narrow slice of the repository the reader needs. */
export interface BlogReaderSource {
  listPublishedInternalBlogRecords(): Promise<PublishedInternalBlogRecord[]>;
  findPublishedInternalBlogRecordBySlug(slug: string): Promise<PublishedInternalBlogRecord | null>;
}

// ---- helpers -------------------------------------------------------------

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
function nested(obj: Record<string, unknown>, a: string, b: string): string {
  const inner = obj[a];
  return inner && typeof inner === "object" ? str((inner as Record<string, unknown>)[b]) : "";
}
function firstNonEmpty(...vals: string[]): string {
  for (const v of vals) {
    const t = v.trim();
    if (t) return t;
  }
  return "";
}
function truncate(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}
function expectedCanonicalUrl(slug: string): string {
  return `${SITE_URL}/blog/${slug}`;
}

/** Rebuild the exact P2.1 hashable projection from a published record, so the
 *  reader can verify the persisted content still matches the job's pinned
 *  version. Mirrors article-serializer.ts#projectArticleToPublishInput. */
function recordToPublishableContent(r: PublishedInternalBlogRecord): PublishableContent {
  const seo = r.seo;
  return {
    title: r.title,
    slug: str(seo.slug),
    body: serializeArticleBody(r.sections),
    excerpt: r.summary,
    canonicalUrl: str(seo.canonicalUrl),
    disclaimer: r.disclaimer,
    seo: { metaDescription: str(seo.metaDescription), keywords: strArray(seo.keywords) },
  };
}

function contentStillMatches(r: PublishedInternalBlogRecord): boolean {
  return computeContentHash(recordToPublishableContent(r)) === r.contentHash;
}

function toSummary(r: PublishedInternalBlogRecord): BlogPostSummary {
  const slug = str(r.seo.slug) || r.slug;
  return {
    slug,
    title: toSafeInline(r.title),
    excerpt: toSafeInline(firstNonEmpty(str(r.seo.metaDescription), r.summary)),
    category: r.category,
    publishedAt: r.publishedAt,
    canonicalUrl: expectedCanonicalUrl(slug),
  };
}

function buildSeo(r: PublishedInternalBlogRecord): BlogPostSeo {
  const seo = r.seo;
  const slug = str(seo.slug) || r.slug;
  const title = firstNonEmpty(toSafeInline(str(seo.title)), toSafeInline(r.title));
  const description = firstNonEmpty(
    toSafeInline(str(seo.metaDescription)),
    toSafeInline(truncate(r.summary, 155)),
  );
  // A persisted canonical URL is honoured only if it is exactly our own
  // /blog/<slug> - otherwise the real, non-404 route is used.
  const persistedCanonical = str(seo.canonicalUrl);
  const canonicalUrl = persistedCanonical === expectedCanonicalUrl(slug) ? persistedCanonical : expectedCanonicalUrl(slug);
  return {
    title,
    description,
    keywords: strArray(seo.keywords),
    canonicalUrl,
    ogTitle: firstNonEmpty(toSafeInline(nested(seo, "openGraph", "title")), title),
    ogDescription: firstNonEmpty(toSafeInline(nested(seo, "openGraph", "description")), description),
    twitterTitle: firstNonEmpty(toSafeInline(nested(seo, "twitter", "title")), title),
    twitterDescription: firstNonEmpty(toSafeInline(nested(seo, "twitter", "description")), description),
  };
}

function toPost(r: PublishedInternalBlogRecord): BlogPost {
  return {
    slug: str(r.seo.slug) || r.slug,
    title: toSafeInline(r.title),
    summary: toSafePlainText(r.summary),
    category: r.category,
    disclaimer: toSafePlainText(r.disclaimer),
    sections: r.sections.map((s) => ({
      heading: toSafeInline(s.heading),
      body: toSafePlainText(s.body),
    })),
    publishedAt: r.publishedAt,
    seo: buildSeo(r),
  };
}

// ---- service ----------------------------------------------------------

export class BlogReaderService {
  constructor(private readonly source: BlogReaderSource = publishingRepository) {}

  /** All published posts, newest first. Excludes any whose current content
   *  has drifted from the published version. */
  async listPosts(): Promise<BlogPostSummary[]> {
    const records = await this.source.listPublishedInternalBlogRecords();
    return records.filter(contentStillMatches).map(toSummary);
  }

  /** One published post, or null (not published, wrong destination, drifted,
   *  or no such slug). */
  async getPostBySlug(slug: string): Promise<BlogPost | null> {
    const record = await this.source.findPublishedInternalBlogRecordBySlug(slug);
    if (!record) return null;
    if (!contentStillMatches(record)) {
      console.warn(
        `[blog-reader] content drift for slug "${slug}" (job hash ${record.contentHash} != current projection) - not serving`,
      );
      return null;
    }
    return toPost(record);
  }

  /** Published slugs - for generateStaticParams and the sitemap. */
  async listSlugs(): Promise<string[]> {
    return (await this.listPosts()).map((p) => p.slug);
  }
}

export const blogReaderService = new BlogReaderService();

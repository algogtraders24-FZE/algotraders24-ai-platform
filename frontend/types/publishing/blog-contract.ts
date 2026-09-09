// types/publishing/blog-contract.ts
// AT24 Publishing Engine (P2.5) - the PUBLIC read model for /blog.
//
// Additive - the contract stays PUB-v1. These are the shapes the reader
// service returns to the public pages; they are a projection of a persisted
// Article, gated by a SUCCEEDED INTERNAL_BLOG PublishingJob.
//
// LOCKED RULE (Sprint P2.5): reader visibility is decided by the PUBLICATION
// JOB, never by `Article.status`. An Article is visible on /blog iff it has a
// SUCCEEDED PublishingJob for destination INTERNAL_BLOG (and the current
// content still hashes to that job's contentHash). `Article.status = published`
// on its own means nothing here - that is exactly the drift P2.3 removed.

export interface BlogPostSeo {
  /** <title> */
  title: string;
  /** <meta name="description"> */
  description: string;
  keywords: string[];
  /** absolute canonical URL - a real, non-404 destination */
  canonicalUrl: string;
  ogTitle: string;
  ogDescription: string;
  twitterTitle: string;
  twitterDescription: string;
}

export interface BlogPostSummary {
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  /** ISO - the publishing job's completedAt */
  publishedAt: string;
  canonicalUrl: string;
}

export interface BlogPostSection {
  heading: string;
  /** sanitized plain text (lib/publishing/sanitize-text.ts) */
  body: string;
}

export interface BlogPost {
  slug: string;
  title: string;
  summary: string;
  category: string;
  disclaimer: string;
  sections: BlogPostSection[];
  publishedAt: string;
  seo: BlogPostSeo;
}

/** What the persistence layer hands the reader service: a published Article
 *  plus the identifying facts of its SUCCEEDED INTERNAL_BLOG job. */
export interface PublishedInternalBlogRecord {
  articleId: string;
  slug: string;
  title: string;
  summary: string;
  category: string;
  disclaimer: string;
  sections: BlogPostSection[]; // raw (unsanitized) - the reader sanitizes
  /** the raw persisted SeoMetadata JSON, shape-guarded by the reader */
  seo: Record<string, unknown>;
  /** ISO - job.completedAt */
  publishedAt: string;
  /** the job's pinned content version */
  contentHash: string;
}

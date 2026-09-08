// services/publishing/article-serializer.ts
// AT24 Publishing Engine (P2.2) - projects a domain `Article` into the
// P2.1 `NormalizedPublishInput` an adapter consumes.
//
// This is the SEAM the locked `contentHash` algorithm depends on: the body
// serializer here decides the exact `body` string that feeds
// `canonicalContentBasis()`. It MUST be deterministic - equivalent article
// content must always produce the same `body`, hence the same hash
// (Sprint P2.2 §5).
//
// No DB, no Prisma, no network - a pure transform. The Publishing Service
// calls this; an adapter never does (it is handed the finished input).

import type { Article, ArticleSection } from "@/types/article";
import {
  buildNormalizedPublishInput,
} from "./content-hash";
import type {
  NormalizedPublishInput,
  NormalizedPublishSeo,
  PublishingDestinationId,
} from "@/types/publishing";

/**
 * Deterministically serialize an Article's sections into a single publishable
 * body string.
 *
 * Format (LOCKED - changing it changes every future contentHash, a PUB-v2
 * concern): each section becomes an ATX H2 heading and its body, sections
 * joined by a blank line:
 *
 *   ## {heading}\n\n{body}
 *
 * joined with "\n\n". Headings and bodies are used verbatim - NO whitespace
 * normalization (a trailing-space edit is a real content change and must
 * change the hash, per publish-input-contract.ts).
 */
export function serializeArticleBody(sections: readonly ArticleSection[]): string {
  return sections
    .map((s) => `## ${s.heading}\n\n${s.body}`)
    .join("\n\n");
}

/** The SEO subset a destination needs, projected from the Article's full
 *  SeoMetadata. `score` and the OG/Twitter blocks are AT24-internal. */
function projectSeo(article: Article): NormalizedPublishSeo {
  const keywords = Array.isArray(article.seo?.keywords) ? article.seo.keywords : [];
  return {
    metaDescription: article.seo?.metaDescription ?? "",
    keywords: [...keywords],
  };
}

export interface ProjectArticleOptions {
  destination: PublishingDestinationId;
}

/**
 * Project a domain Article + a destination into a fully-formed
 * NormalizedPublishInput, computing `contentHash` from the participating
 * fields. Article content is NOT copied anywhere durable by this call - the
 * input is assembled on demand (Sprint P2.2 §1 "no duplication of Article
 * content").
 */
export function projectArticleToPublishInput(
  article: Article,
  opts: ProjectArticleOptions,
): NormalizedPublishInput {
  return buildNormalizedPublishInput({
    articleId: article.id,
    destination: opts.destination,
    title: article.title,
    slug: article.seo?.slug ?? "",
    body: serializeArticleBody(article.sections ?? []),
    excerpt: article.summary ?? "",
    canonicalUrl: article.seo?.canonicalUrl ?? "",
    disclaimer: article.disclaimer ?? "",
    seo: projectSeo(article),
  });
}

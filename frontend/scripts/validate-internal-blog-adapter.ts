// scripts/validate-internal-blog-adapter.ts
// AT24 Publishing Engine (P2.2) - InternalBlogAdapter + Article serializer +
// content-hash stability. Pure / in-memory - no DB, no network. House test
// pattern (node:assert/strict). Run: npm run validate:internal-blog-adapter

import assert from "node:assert/strict";

import type { Article, ArticleSection } from "../types/article";
import {
  isPublishError,
  validatePublishResult,
  isDestinationAdapter,
  type NormalizedPublishInput,
} from "../types/publishing";
import { computeContentHash } from "../services/publishing/content-hash";
import {
  serializeArticleBody,
  projectArticleToPublishInput,
} from "../services/publishing/article-serializer";
import { InternalBlogAdapter, internalBlogAdapter } from "../services/publishing/destinations/internal-blog.adapter";
import {
  getDestinationAdapter,
  everyDestinationHasAdapter,
} from "../services/publishing/destinations/registry";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ok   - ${name}`);
    })
    .catch((err: unknown) => {
      failed += 1;
      console.error(`  FAIL - ${name}`);
      console.error(err instanceof Error ? `    ${err.message}` : `    ${String(err)}`);
    });
}

// ---- fixtures -----------------------------------------------------------

const SECTIONS: ArticleSection[] = [
  { heading: "Market Overview", body: "Gold held a constructive tone into the London fix as real yields eased." },
  { heading: "Key Levels", body: "Support 2,640 / 2,610. Resistance 2,700, then the 2,725 swing high." },
  { heading: "Outlook", body: "Current evidence favors a bullish scenario while 2,610 holds on a daily close." },
];

function makeArticle(over: Partial<Article> = {}): Article {
  const slug = over.seo?.slug ?? "gold-analysis";
  return {
    id: "art_gold_1",
    title: "Gold Analysis",
    category: "gold-analysis",
    summary: "Overview, key levels, and outlook for XAUUSD.",
    sections: SECTIONS,
    disclaimer: "This is not financial advice. Trading involves risk.",
    seo: {
      title: "Gold Analysis",
      metaDescription: "Gold analysis - key levels and outlook from Algotraders24 AI.",
      keywords: ["gold", "xauusd", "gold analysis"],
      slug,
      canonicalUrl: `https://algotraders24.ai/blog/${slug}`,
      openGraph: { title: "Gold Analysis", description: "", type: "article", url: "" },
      twitter: { card: "summary_large_image", title: "Gold Analysis", description: "" },
      score: 90,
    },
    status: "draft",
    sourceType: "ai",
    history: [],
    createdAt: "2026-09-09T00:00:00.000Z",
    scheduledFor: null,
    publishedAt: null,
    ...over,
  };
}

// ---- tests ------------------------------------------------------------

async function main() {
  console.log("\nInternalBlogAdapter + serializer + content-hash - validation\n");

  // -- serializer determinism (§5) ---------------------------------
  await test("serializeArticleBody is deterministic and section-ordered", () => {
    const a = serializeArticleBody(SECTIONS);
    const b = serializeArticleBody(SECTIONS.map((s) => ({ ...s })));
    assert.equal(a, b);
    assert.ok(a.startsWith("## Market Overview\n\n"));
    assert.ok(a.indexOf("## Key Levels") < a.indexOf("## Outlook"));
  });
  await test("equivalent article content -> identical contentHash", () => {
    const h1 = projectArticleToPublishInput(makeArticle(), { destination: "INTERNAL_BLOG" }).contentHash;
    const h2 = projectArticleToPublishInput(makeArticle(), { destination: "INTERNAL_BLOG" }).contentHash;
    assert.equal(h1, h2);
    assert.match(h1, /^[0-9a-f]{64}$/);
  });
  await test("changed publishable content -> different contentHash", () => {
    const base = projectArticleToPublishInput(makeArticle(), { destination: "INTERNAL_BLOG" }).contentHash;
    const editedBody = projectArticleToPublishInput(
      makeArticle({ sections: [...SECTIONS, { heading: "Risks", body: "A hawkish surprise invalidates the thesis." }] }),
      { destination: "INTERNAL_BLOG" },
    ).contentHash;
    const editedTitle = projectArticleToPublishInput(makeArticle({ title: "Gold Analysis " }), {
      destination: "INTERNAL_BLOG",
    }).contentHash;
    assert.notEqual(base, editedBody);
    assert.notEqual(base, editedTitle);
  });
  await test("articleId / destination do NOT affect the hash", () => {
    const a = projectArticleToPublishInput(makeArticle({ id: "art_A" }), { destination: "INTERNAL_BLOG" });
    const b = projectArticleToPublishInput(makeArticle({ id: "art_B" }), { destination: "INTERNAL_BLOG" });
    assert.equal(a.contentHash, b.contentHash);
    assert.notEqual(a.articleId, b.articleId);
  });
  await test("projection fills the canonical URL from the slug", () => {
    const input = projectArticleToPublishInput(makeArticle(), { destination: "INTERNAL_BLOG" });
    assert.equal(input.canonicalUrl, "https://algotraders24.ai/blog/gold-analysis");
    assert.equal(input.destination, "INTERNAL_BLOG");
    assert.ok(computeContentHash(input) === input.contentHash);
  });

  // -- registry ---------------------------------------------------
  await test("registry resolves INTERNAL_BLOG and covers every declared destination", () => {
    assert.ok(everyDestinationHasAdapter());
    assert.equal(getDestinationAdapter("INTERNAL_BLOG").destination, "INTERNAL_BLOG");
  });

  // -- adapter conformance (§6) ---------------------------------
  await test("InternalBlogAdapter satisfies the DestinationAdapter contract", () => {
    assert.ok(isDestinationAdapter(internalBlogAdapter));
    assert.ok(internalBlogAdapter instanceof InternalBlogAdapter);
    assert.equal(internalBlogAdapter.destination, "INTERNAL_BLOG");
  });
  await test("validate() accepts a well-formed article projection", async () => {
    const input = projectArticleToPublishInput(makeArticle(), { destination: "INTERNAL_BLOG" });
    const res = await internalBlogAdapter.validate(input);
    assert.equal(res.valid, true, JSON.stringify(res.errors));
    assert.deepEqual(res.errors, []);
  });
  await test("validate() returns VALIDATION_ERROR (does not throw) for a thin body", async () => {
    const input: NormalizedPublishInput = {
      ...projectArticleToPublishInput(makeArticle(), { destination: "INTERNAL_BLOG" }),
      body: "too short",
    };
    const res = await internalBlogAdapter.validate(input);
    assert.equal(res.valid, false);
    assert.equal(res.errors[0]?.code, "VALIDATION_ERROR");
    assert.ok(isPublishError(res.errors[0]));
  });
  await test("validate() rejects a canonicalUrl that does not match the slug/domain", async () => {
    const input: NormalizedPublishInput = {
      ...projectArticleToPublishInput(makeArticle(), { destination: "INTERNAL_BLOG" }),
      canonicalUrl: "https://evil.example.com/blog/gold-analysis",
    };
    const res = await internalBlogAdapter.validate(input);
    assert.equal(res.valid, false);
  });
  await test("validate() rejects a raw <script> in the body (stored-XSS guard)", async () => {
    const bad = makeArticle({
      sections: [{ heading: "Overview", body: "ok ".repeat(40) + "<script>alert(1)</script>" }, ...SECTIONS.slice(1)],
    });
    const input = projectArticleToPublishInput(bad, { destination: "INTERNAL_BLOG" });
    const res = await internalBlogAdapter.validate(input);
    assert.equal(res.valid, false);
  });
  await test("validate() rejects a missing disclaimer (compliance)", async () => {
    const input = projectArticleToPublishInput(makeArticle({ disclaimer: "" }), { destination: "INTERNAL_BLOG" });
    const res = await internalBlogAdapter.validate(input);
    assert.equal(res.valid, false);
  });
  await test("publish() returns a valid PublishResult - on-site URL, NO fabricated external id", async () => {
    const input = projectArticleToPublishInput(makeArticle(), { destination: "INTERNAL_BLOG" });
    const result = await internalBlogAdapter.publish(input);
    assert.equal(validatePublishResult(result).valid, true);
    assert.equal(result.success, true);
    assert.equal(result.destination, "INTERNAL_BLOG");
    assert.equal(result.externalReference, null);
    assert.equal(result.externalUrl, "https://algotraders24.ai/blog/gold-analysis");
    assert.match(result.publishedAt, /^\d{4}-\d{2}-\d{2}T/);
  });
  await test("publish() throws a typed PublishError for invalid content", async () => {
    const input: NormalizedPublishInput = {
      ...projectArticleToPublishInput(makeArticle(), { destination: "INTERNAL_BLOG" }),
      body: "nope",
    };
    await assert.rejects(
      () => internalBlogAdapter.publish(input),
      (err: unknown) => isPublishError(err) && (err as { code: string }).code === "VALIDATION_ERROR",
    );
  });
  await test("adapter receives NO auth material - the input has none to give", () => {
    const input = projectArticleToPublishInput(makeArticle(), { destination: "INTERNAL_BLOG" });
    for (const forbidden of ["userId", "session", "role", "token", "isOwner", "permissions"]) {
      assert.equal(forbidden in input, false);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

void main();

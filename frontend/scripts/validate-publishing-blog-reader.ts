// scripts/validate-publishing-blog-reader.ts
// AT24 Publishing Engine (P2.5) - the public /blog read model. Pure /
// in-memory (plus a source read of two service files). No DB, no network.
//   npm run validate:publishing-blog-reader

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import type { ArticleSection } from "../types/article";
import type { PublishedInternalBlogRecord } from "../types/publishing";
import { computeContentHash } from "../services/publishing/content-hash";
import { serializeArticleBody } from "../services/publishing/article-serializer";
import { BlogReaderService, type BlogReaderSource } from "../services/publishing/blog-reader.service";
import { toSafePlainText, toSafeInline } from "../lib/publishing/sanitize-text";

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), "..");

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

// ---- fake source modelling the repo's SUCCEEDED-INTERNAL_BLOG query -----

interface Entry {
  article: {
    slug: string;
    title: string;
    summary: string;
    category: string;
    disclaimer: string;
    sections: ArticleSection[];
    seo: Record<string, unknown>;
    deletedAt: string | null;
  };
  jobStatus: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  jobDestination: "INTERNAL_BLOG" | "OTHER";
  jobDeleted: boolean;
  completedAt: string;
  /** if null, computed correctly from the article; set a string to force drift */
  contentHashOverride: string | null;
}

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://algotraders24.ai";

function correctHash(e: Entry): string {
  return computeContentHash({
    title: e.article.title,
    slug: String(e.article.seo.slug ?? ""),
    body: serializeArticleBody(e.article.sections),
    excerpt: e.article.summary,
    canonicalUrl: String(e.article.seo.canonicalUrl ?? ""),
    disclaimer: e.article.disclaimer,
    seo: {
      metaDescription: String(e.article.seo.metaDescription ?? ""),
      keywords: Array.isArray(e.article.seo.keywords) ? (e.article.seo.keywords as string[]) : [],
    },
  });
}

function toRecord(e: Entry): PublishedInternalBlogRecord {
  return {
    articleId: `art_${e.article.slug}`,
    slug: e.article.slug,
    title: e.article.title,
    summary: e.article.summary,
    category: e.article.category,
    disclaimer: e.article.disclaimer,
    sections: e.article.sections,
    seo: e.article.seo,
    publishedAt: e.completedAt,
    contentHash: e.contentHashOverride ?? correctHash(e),
  };
}

class FakeSource implements BlogReaderSource {
  constructor(private entries: Entry[]) {}
  private visible() {
    return this.entries.filter(
      (e) =>
        e.jobStatus === "SUCCEEDED" &&
        e.jobDestination === "INTERNAL_BLOG" &&
        !e.jobDeleted &&
        e.article.deletedAt === null,
    );
  }
  async listPublishedInternalBlogRecords() {
    return this.visible()
      .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))
      .map(toRecord);
  }
  async findPublishedInternalBlogRecordBySlug(slug: string) {
    const e = this.visible().find((x) => x.article.slug === slug);
    return e ? toRecord(e) : null;
  }
}

// ---- fixtures ----------------------------------------------------------

function seoFor(slug: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Gold Analysis",
    metaDescription: "Gold analysis - key levels and outlook from Algotraders24 AI.",
    keywords: ["gold", "xauusd", "outlook"],
    slug,
    canonicalUrl: `${SITE}/blog/${slug}`,
    openGraph: { title: "Gold OG", description: "Gold OG desc", type: "article", url: "" },
    twitter: { card: "summary_large_image", title: "Gold TW", description: "Gold TW desc" },
    score: 90,
    ...over,
  };
}

const GOOD_SECTIONS: ArticleSection[] = [
  { heading: "Market Overview", body: "Gold held a constructive tone into the London fix as real yields eased." },
  { heading: "Key Levels", body: "Support 2,640 / 2,610. Resistance 2,700, then 2,725." },
  { heading: "Outlook", body: "Current evidence favors a bullish scenario while 2,610 holds." },
];

function entry(over: Partial<Entry> & { slug: string }): Entry {
  const slug = over.slug;
  const base: Entry = {
    article: {
      slug,
      title: "Gold Analysis",
      summary: "Overview, key levels, and outlook for XAUUSD.",
      category: "gold-analysis",
      disclaimer: "This is not financial advice. Trading involves risk.",
      sections: GOOD_SECTIONS,
      seo: seoFor(slug),
      deletedAt: null,
    },
    jobStatus: "SUCCEEDED",
    jobDestination: "INTERNAL_BLOG",
    jobDeleted: false,
    completedAt: "2026-09-09T12:00:00.000Z",
    contentHashOverride: null,
  };
  return { ...base, ...over, article: { ...base.article, ...(over.article ?? {}) } };
}

// ---- tests -----------------------------------------------------------

async function main() {
  console.log("\nPublishing /blog reader - validation\n");

  // === the LOCKED RULE: visibility is the job, not Article.status ===
  await test("the reader query filters on the SUCCEEDED INTERNAL_BLOG job, not Article.status (LOCKED RULE)", () => {
    // Behavioural proof is the visibility-matrix test below (a FakeSource that
    // models the query). This is a source guard on the actual Prisma query.
    const repoSrc = readFileSync(join(FRONTEND, "services/publishing/publishing.repository.ts"), "utf8")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*") && !l.trimStart().startsWith("/*"))
      .join("\n");
    const from = repoSrc.indexOf("listPublishedInternalBlogRecords(): Promise");
    const to = repoSrc.indexOf("\ntype PublishedJobWithArticleRow");
    assert.ok(from >= 0 && to > from, "found the P2.5 query methods");
    const q = repoSrc.slice(from, to);
    assert.ok(q.includes('destination: "INTERNAL_BLOG"'), "query filters destination INTERNAL_BLOG");
    assert.ok(q.includes('status: "SUCCEEDED"'), "query filters status SUCCEEDED");
    assert.ok(q.includes("deletedAt: null"), "query excludes soft-deleted rows");
    assert.ok(q.includes("article: { deletedAt: null }") || q.includes("article: { slug, deletedAt: null }"), "query excludes soft-deleted articles");
    assert.ok(!q.includes('"published"') && !/\barticle\.status\b/.test(q), "query does not read the 'published' article status");
  });

  await test("only a SUCCEEDED INTERNAL_BLOG job makes an article visible", async () => {
    const svc = new BlogReaderService(
      new FakeSource([
        entry({ slug: "live", jobStatus: "SUCCEEDED", jobDestination: "INTERNAL_BLOG" }),
        entry({ slug: "pending", jobStatus: "PENDING" }),
        entry({ slug: "running", jobStatus: "RUNNING" }),
        entry({ slug: "failed-job", jobStatus: "FAILED" }),
        entry({ slug: "cancelled", jobStatus: "CANCELLED" }),
        entry({ slug: "wrong-dest", jobStatus: "SUCCEEDED", jobDestination: "OTHER" }),
        entry({ slug: "job-deleted", jobStatus: "SUCCEEDED", jobDeleted: true }),
      ]),
    );
    const posts = await svc.listPosts();
    assert.deepEqual(posts.map((p) => p.slug), ["live"]);
    assert.ok(await svc.getPostBySlug("live"));
    for (const s of ["pending", "running", "failed-job", "cancelled", "wrong-dest", "job-deleted"]) {
      assert.equal(await svc.getPostBySlug(s), null, `${s} must not be visible`);
    }
  });

  await test("a soft-deleted article is not visible even with a SUCCEEDED job", async () => {
    const e = entry({ slug: "gone" });
    e.article.deletedAt = "2026-09-09T13:00:00.000Z";
    const svc = new BlogReaderService(new FakeSource([e]));
    assert.equal((await svc.listPosts()).length, 0);
    assert.equal(await svc.getPostBySlug("gone"), null);
  });

  await test("an unknown slug returns null", async () => {
    const svc = new BlogReaderService(new FakeSource([entry({ slug: "real" })]));
    assert.equal(await svc.getPostBySlug("nope"), null);
  });

  // === content drift ===
  await test("content that has drifted from the published version is NOT served", async () => {
    const svc = new BlogReaderService(
      new FakeSource([
        entry({ slug: "ok" }),
        entry({ slug: "drifted", contentHashOverride: "0".repeat(64) }),
      ]),
    );
    assert.deepEqual((await svc.listPosts()).map((p) => p.slug), ["ok"]);
    assert.equal(await svc.getPostBySlug("drifted"), null);
  });

  // === sanitization ===
  await test("an XSS payload in a section body is sanitized before render", async () => {
    const e = entry({ slug: "xss" });
    e.article.sections = [
      { heading: "Overview <img src=x onerror=alert(1)>", body: "hello <script>alert('xss')</script> world <b>bold</b>" },
      ...GOOD_SECTIONS.slice(1),
    ];
    // contentHash is computed from the RAW (pre-sanitize) content, so it still matches
    const svc = new BlogReaderService(new FakeSource([e]));
    const post = await svc.getPostBySlug("xss");
    assert.ok(post);
    const body = post!.sections[0].body;
    const heading = post!.sections[0].heading;
    assert.ok(!body.includes("<script"), "no <script tag");
    assert.ok(!body.includes("</script"), "no </script tag");
    assert.ok(!body.includes("<b>"), "no <b> tag");
    assert.ok(!body.includes("<") && !body.includes(">"), "no angle brackets at all");
    assert.ok(!heading.includes("<") && !heading.includes(">"), "heading has no angle brackets");
    assert.ok(body.includes("hello") && body.includes("world"), "prose text is preserved");
  });

  await test("sanitizer keeps line breaks (pre-wrap) but strips control chars", () => {
    assert.equal(toSafePlainText("a\nb"), "a\nb");
    assert.equal(toSafePlainText("a b"), "ab");
    assert.equal(toSafeInline("  x   y  "), "x y");
  });

  // === metadata ===
  await test("generateMetadata source: persisted SEO fields used, with fallbacks", async () => {
    const svc = new BlogReaderService(new FakeSource([entry({ slug: "meta" })]));
    const post = await svc.getPostBySlug("meta");
    assert.ok(post);
    const s = post!.seo;
    assert.equal(s.title, "Gold Analysis");
    assert.equal(s.description, "Gold analysis - key levels and outlook from Algotraders24 AI.");
    assert.deepEqual(s.keywords, ["gold", "xauusd", "outlook"]);
    assert.equal(s.ogTitle, "Gold OG");
    assert.equal(s.twitterDescription, "Gold TW desc");
  });

  await test("metadata falls back to the article title / summary when SEO fields are blank", async () => {
    const e = entry({ slug: "fallback" });
    e.article.seo = seoFor("fallback", { title: "", metaDescription: "", openGraph: {}, twitter: {} });
    const svc = new BlogReaderService(new FakeSource([e]));
    const post = await svc.getPostBySlug("fallback");
    assert.ok(post);
    assert.equal(post!.seo.title, "Gold Analysis"); // from article.title
    assert.ok(post!.seo.description.length > 0); // from article.summary
    assert.equal(post!.seo.ogTitle, "Gold Analysis");
  });

  // === canonical URL is a real, non-404 destination ===
  await test("canonical URL is always the real /blog/<slug> route", async () => {
    const good = entry({ slug: "canon-ok" });
    const bad = entry({ slug: "canon-bad" });
    bad.article.seo = seoFor("canon-bad", { canonicalUrl: "https://evil.example.com/x" });
    const svc = new BlogReaderService(new FakeSource([good, bad]));
    assert.equal((await svc.getPostBySlug("canon-ok"))!.seo.canonicalUrl, `${SITE}/blog/canon-ok`);
    assert.equal((await svc.getPostBySlug("canon-bad"))!.seo.canonicalUrl, `${SITE}/blog/canon-bad`);
    const summaries = await svc.listPosts();
    for (const s of summaries) assert.equal(s.canonicalUrl, `${SITE}/blog/${s.slug}`);
  });

  // === slug resolution + listing order ===
  await test("listPosts is newest-first and getPostBySlug resolves each", async () => {
    const svc = new BlogReaderService(
      new FakeSource([
        entry({ slug: "old", completedAt: "2026-09-01T00:00:00.000Z" }),
        entry({ slug: "new", completedAt: "2026-09-09T00:00:00.000Z" }),
        entry({ slug: "mid", completedAt: "2026-09-05T00:00:00.000Z" }),
      ]),
    );
    assert.deepEqual((await svc.listPosts()).map((p) => p.slug), ["new", "mid", "old"]);
    assert.deepEqual((await svc.listSlugs()).sort(), ["mid", "new", "old"]);
    for (const s of ["old", "new", "mid"]) assert.equal((await svc.getPostBySlug(s))!.slug, s);
  });

  await test("empty state: no published posts", async () => {
    const svc = new BlogReaderService(new FakeSource([]));
    assert.deepEqual(await svc.listPosts(), []);
    assert.deepEqual(await svc.listSlugs(), []);
    assert.equal(await svc.getPostBySlug("anything"), null);
  });

  // === the page renders as React text children (no dangerouslySetInnerHTML) ===
  await test("no /blog page actually uses dangerouslySetInnerHTML", () => {
    for (const f of ["app/blog/page.tsx", "app/blog/[slug]/page.tsx"]) {
      const src = readFileSync(join(FRONTEND, f), "utf8");
      assert.ok(
        !/dangerouslySetInnerHTML\s*[=:]/.test(src),
        `${f} must not use dangerouslySetInnerHTML as a prop`,
      );
    }
  });

  await test("sitemap includes /blog and derives post URLs from the reader", () => {
    const src = readFileSync(join(FRONTEND, "app/sitemap.ts"), "utf8");
    assert.ok(src.includes("/blog"), "sitemap lists /blog");
    assert.ok(src.includes("blogReaderService.listSlugs"), "sitemap derives post slugs from the reader");
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

void main();

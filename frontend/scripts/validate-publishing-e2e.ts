// scripts/validate-publishing-e2e.ts
// AT24 Publishing Engine - P2.6 BETA GATE end-to-end check.
//
// REQUIRES A DATABASE. Run:
//   npm run validate:publishing-e2e
// (wired with --env-file=.env so DATABASE_URL / DIRECT_URL are loaded).
//
// Exercises the COMPLETE production path against the real Prisma layer - the
// wiring the in-memory suites (109 tests) cannot prove: the real query, the
// real commitSuccess transaction, real ownership, real content-drift.
//
// Fully self-cleaning: every row it creates (articles, jobs, attempts, audit)
// is HARD-DELETED at the end, pass or fail. It never touches a row it did not
// create.

import { prisma } from "@/lib/prisma";
import { articleService } from "@/services/publishing/article.service";
import { publishingService } from "@/services/publishing/publishing.service";
import { blogReaderService } from "@/services/publishing/blog-reader.service";
import { computeContentHash } from "@/services/publishing/content-hash";
import { serializeArticleBody } from "@/services/publishing/article-serializer";
import type { ContentCategory } from "@/types/content-category";

const TAG = "p26-e2e-disposable";
const made = { articleIds: new Set<string>(), jobIds: new Set<string>() };

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) {
    passed += 1;
    console.log(`  ok   - ${msg}`);
  } else {
    failed += 1;
    console.error(`  FAIL - ${msg}`);
  }
}
async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    failed += 1;
    console.error(`  FAIL - ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function cleanup() {
  try {
    // Also catch any disposable article this run created but failed to track
    // (its seo.keywords carries TAG). publishing_jobs -> articles is ON DELETE
    // CASCADE, so deleting the article removes its jobs + attempts too.
    const tagged = await prisma.article
      .findMany({ where: { seo: { path: ["keywords"], array_contains: TAG } }, select: { id: true } })
      .catch(() => [] as { id: string }[]);
    const artIds = [...new Set([...made.articleIds, ...tagged.map((t) => t.id)])];
    if (artIds.length) {
      await prisma.auditLog.deleteMany({ where: { targetType: "Article", targetId: { in: artIds } } }).catch(() => {});
      await prisma.article.deleteMany({ where: { id: { in: artIds } } });
    }
  } catch (e) {
    console.error("  cleanup warning:", e instanceof Error ? e.message : e);
  }
}

const ALL_CATS: ContentCategory[] = [
  "weekly-review", "economic-preview", "market-outlook", "index-analysis", "crypto-analysis",
  "forex-analysis", "technical-analysis", "fundamental-analysis", "gold-analysis",
];

async function draft(owner: string, prefer: ContentCategory[] = []): Promise<{ id: string; slug: string }> {
  const cats = [...new Set([...prefer, ...ALL_CATS])];
  for (const category of cats) {
    try {
      const a = await articleService.createDraft(owner, {
        category,
        keywords: [TAG, "gold", "outlook"], // 3+ keywords so validateArticle passes
        aiOverviewText:
          "P2.6 beta-gate end-to-end check. Disposable row created by scripts/validate-publishing-e2e.ts and " +
          "hard-deleted when the run finishes. Content only exercises the publishing pipeline in the real environment.",
      });
      made.articleIds.add(a.id);
      return { id: a.id, slug: a.seo.slug };
    } catch (e) {
      if (e instanceof Error && /Unique constraint/.test(e.message)) continue;
      throw e;
    }
  }
  throw new Error("no free category slug for this owner");
}

async function main() {
  console.log("\nPublishing Engine - P2.6 BETA GATE end-to-end\n");

  const owner = await prisma.user.findFirst({ where: { deletedAt: null }, select: { id: true, email: true } });
  const other = await prisma.user.findFirst({
    where: { deletedAt: null, id: { not: owner?.id ?? "" } },
    select: { id: true },
  });
  if (!owner) throw new Error("no User to own the disposable Articles");
  console.log(`  (owner=${owner.email}, cross-user check ${other ? "enabled" : "SKIPPED - only one user"})\n`);

  // ============ POSITIVE PATH: "Publish now" ============
  console.log("-- positive path: dashboard 'Publish now' --");
  const A = await draft(owner.id);
  await step("publishArticleNow", async () => {
    const { job } = await publishingService.publishArticleNow(owner.id, A.id);
    made.jobIds.add(job.id);
    ok(job.status === "SUCCEEDED", "job -> SUCCEEDED");
    ok(job.destination === "INTERNAL_BLOG", "destination INTERNAL_BLOG");
    ok(/^[0-9a-f]{64}$/.test(job.contentHash), "job has a sha256 contentHash");

    const art = await articleService.getById(owner.id, A.id);
    ok(art.status === "published", "Article.status -> published");
    ok(art.history.some((h) => h.action === "published"), "Article history has a 'published' entry");

    const attempts = await publishingService.listJobAttempts(owner.id, job.id);
    ok(attempts.length === 1 && attempts[0].status === "SUCCEEDED", "exactly one SUCCEEDED attempt");

    const audit = await prisma.auditLog.findMany({ where: { targetType: "Article", targetId: A.id }, select: { action: true } });
    const actions = new Set(audit.map((x) => x.action));
    ok(actions.has("article.drafted"), "audit: article.drafted");
    ok(actions.has("article.published"), "audit: article.published");
  });

  await step("/blog reader shows the published post", async () => {
    const post = await blogReaderService.getPostBySlug(A.slug);
    ok(post !== null, "getPostBySlug returns the post");
    ok(post?.slug === A.slug, "slug resolves");
    ok(!!post && post.sections.length >= 1, "sections render");
    ok(!!post && post.seo.canonicalUrl.endsWith(`/blog/${A.slug}`), "canonical URL is the real /blog/<slug>");
    ok(!!post && post.seo.title.length > 0 && post.seo.description.length > 0, "SEO title + description present");
    const list = await blogReaderService.listPosts();
    ok(list.some((p) => p.slug === A.slug), "post appears in listPosts()");
    ok((await blogReaderService.listSlugs()).includes(A.slug), "slug in listSlugs() (sitemap / static params)");
  });

  await step("re-publish is idempotent (no second job)", async () => {
    const before = await prisma.publishingJob.count({ where: { articleId: A.id } });
    const { job } = await publishingService.publishArticleNow(owner.id, A.id);
    const after = await prisma.publishingJob.count({ where: { articleId: A.id } });
    ok(job.status === "SUCCEEDED" && before === after, "same job, count unchanged");
  });

  // ============ SCHEDULED PATH ============
  console.log("\n-- scheduled path: fixed UTC slot --");
  const S = await draft(owner.id);
  await step("scheduled job is invisible before its slot, visible after", async () => {
    const job = await publishingService.createJob({
      userId: owner.id,
      articleId: S.id,
      destination: "INTERNAL_BLOG",
      schedule: { kind: "slot", slot: "00:00" },
    });
    made.jobIds.add(job.id);
    ok(!!job.scheduledFor && Date.parse(job.scheduledFor) > Date.now(), "scheduledFor is a future UTC instant");

    const d1 = await publishingService.dispatch({ limit: 100 });
    ok(!d1.results.some((r) => r.jobId === job.id), "dispatcher SKIPS the future job");
    ok((await blogReaderService.getPostBySlug(S.slug)) === null, "not visible on /blog before its slot");

    // simulate the slot arriving
    await prisma.publishingJob.update({ where: { id: job.id }, data: { scheduledFor: new Date(Date.now() - 60_000) } });
    const d2 = await publishingService.dispatch({ limit: 100 });
    ok(d2.results.some((r) => r.jobId === job.id && r.outcome === "SUCCEEDED"), "dispatcher runs it once due -> SUCCEEDED");
    ok((await blogReaderService.getPostBySlug(S.slug)) !== null, "visible on /blog after dispatch");
  });

  // ============ NEGATIVE PATHS ============
  console.log("\n-- negative paths --");

  const D = await draft(owner.id);
  await step("an unpublished draft is not visible / not listed", async () => {
    ok((await blogReaderService.getPostBySlug(D.slug)) === null, "getPostBySlug -> null");
    ok(!(await blogReaderService.listPosts()).some((p) => p.slug === D.slug), "not in listPosts()");
  });

  await step("unknown slug -> null", async () => {
    ok((await blogReaderService.getPostBySlug("p26-no-such-slug-zzz")) === null, "getPostBySlug(unknown) -> null");
  });

  await step("an invalid (thin) article is blocked from publishing", async () => {
    // update D to be too thin for validateArticle (< 3 sections)
    await prisma.article.update({ where: { id: D.id }, data: { sections: [{ heading: "Only one", body: "thin" }] } });
    let threw = false;
    try {
      await publishingService.publishArticleNow(owner.id, D.id);
    } catch {
      threw = true;
    }
    ok(threw, "publishArticleNow throws for a thin article");
    ok((await prisma.publishingJob.count({ where: { articleId: D.id } })) === 0, "no job was created");
  });

  await step("content drift: a post whose article content changed is NOT served", async () => {
    // A is published. Directly mutate its persisted content (bypassing the
    // read-only guard, as a rogue edit / legacy path would) so the current
    // projection no longer hashes to the job's contentHash.
    const row = await prisma.article.findUnique({ where: { id: A.id }, select: { sections: true } });
    const sections = Array.isArray(row?.sections) ? (row!.sections as { heading: string; body: string }[]) : [];
    const tampered = [...sections, { heading: "Rogue edit", body: "This paragraph was added after publication." }];
    await prisma.article.update({ where: { id: A.id }, data: { sections: tampered } });

    ok((await blogReaderService.getPostBySlug(A.slug)) === null, "reader refuses the drifted post");
    ok(!(await blogReaderService.listPosts()).some((p) => p.slug === A.slug), "drifted post drops out of listPosts()");

    // restore A so the rest of the run / cleanup is sane
    await prisma.article.update({ where: { id: A.id }, data: { sections } });
    const restoredHash = computeContentHash({
      title: (await articleService.getById(owner.id, A.id)).title,
      slug: A.slug,
      body: serializeArticleBody(sections),
      excerpt: (await articleService.getById(owner.id, A.id)).summary,
      canonicalUrl: (await articleService.getById(owner.id, A.id)).seo.canonicalUrl,
      disclaimer: (await articleService.getById(owner.id, A.id)).disclaimer,
      seo: {
        metaDescription: (await articleService.getById(owner.id, A.id)).seo.metaDescription,
        keywords: (await articleService.getById(owner.id, A.id)).seo.keywords,
      },
    });
    const job = await prisma.publishingJob.findFirst({ where: { articleId: A.id, status: "SUCCEEDED" }, select: { contentHash: true } });
    ok(job?.contentHash === restoredHash, "after restore, content matches the job again");
    ok((await blogReaderService.getPostBySlug(A.slug)) !== null, "reader serves it again after restore");
  });

  if (other) {
    await step("cross-user: a different user cannot read or run this owner's job", async () => {
      const job = await prisma.publishingJob.findFirst({ where: { articleId: A.id }, select: { id: true } });
      let r1 = false;
      let r2 = false;
      try {
        await publishingService.getJob(other.id, job!.id);
      } catch {
        r1 = true;
      }
      try {
        await publishingService.runAttempt({ userId: other.id, jobId: job!.id });
      } catch {
        r2 = true;
      }
      ok(r1, "getJob as another user -> rejected (404)");
      ok(r2, "runAttempt as another user -> rejected");
      let r3 = false;
      try {
        await publishingService.publishArticleNow(other.id, A.id);
      } catch {
        r3 = true;
      }
      ok(r3, "publishArticleNow on another user's article -> rejected");
    });
  }

  await step("write-path XSS guard: a raw <script> in content fails the publish", async () => {
    const X = await draft(owner.id);
    await prisma.article.update({
      where: { id: X.id },
      data: {
        sections: [
          { heading: "Overview", body: "Legitimate lead paragraph with enough length to clear the minimum. <script>alert('xss')</script>" },
          { heading: "Levels", body: "Support and resistance discussion, long enough to be a real section body here." },
          { heading: "Outlook", body: "Directional scenarios and the risks around them, again with real length." },
        ],
      },
    });
    let threw = false;
    try {
      await publishingService.publishArticleNow(owner.id, X.id);
    } catch {
      threw = true;
    }
    ok(threw, "publishArticleNow rejects content containing a raw <script>");
    ok((await prisma.publishingJob.count({ where: { articleId: X.id } })) === 0, "no job created for XSS content");
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
}

main()
  .then(cleanup)
  .then(() => prisma.$disconnect())
  .then(() => process.exit(failed > 0 ? 1 : 0))
  .catch(async (e) => {
    console.error("\nE2E ERROR:", e instanceof Error ? e.stack : e);
    await cleanup();
    await prisma.$disconnect();
    process.exit(1);
  });

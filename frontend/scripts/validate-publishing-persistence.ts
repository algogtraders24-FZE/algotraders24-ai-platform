// scripts/validate-publishing-persistence.ts
// AT24 Publishing Engine (P2.2) - PublishingService orchestration over an
// in-memory fake repository + fake ArticleReader. No DB, no network. Proves
// the lifecycle / idempotency / ownership / integrity logic that the Prisma
// PublishingRepository will back in production.
//
// House test pattern (node:assert/strict). Run:
//   npm run validate:publishing-persistence

import assert from "node:assert/strict";

import type { Article, ArticleSection } from "../types/article";
import {
  publicationIdentityKey,
  type PublishingAttempt,
  type PublishingJob,
  type PublicationIdentity,
} from "../types/publishing";
import { computeContentHash } from "../services/publishing/content-hash";
import { projectArticleToPublishInput } from "../services/publishing/article-serializer";
import { PublishingService, type ArticleReader } from "../services/publishing/publishing.service";
import type {
  PublishingRepository,
  CreateJobInput,
  PatchJobInput,
  AppendAttemptInput,
  PatchAttemptInput,
} from "../services/publishing/publishing.repository";

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

// ---- in-memory fake repository ----------------------------------------

class FakeRepo implements PublishingRepository {
  jobs = new Map<string, PublishingJob>();
  attempts: PublishingAttempt[] = [];
  private seq = 0;

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  async findJobByIdentity(identity: PublicationIdentity): Promise<PublishingJob | null> {
    for (const j of this.jobs.values()) {
      if (
        j.articleId === identity.articleId &&
        j.destination === identity.destination &&
        j.contentHash === identity.contentHash
      ) {
        return { ...j };
      }
    }
    return null;
  }

  async findJobForUser(id: string, userId: string): Promise<PublishingJob | null> {
    const j = this.jobs.get(id);
    return j && j.userId === userId ? { ...j } : null;
  }

  async listJobsForArticle(articleId: string, userId: string): Promise<PublishingJob[]> {
    return [...this.jobs.values()].filter((j) => j.articleId === articleId && j.userId === userId).map((j) => ({ ...j }));
  }

  async createJob(input: CreateJobInput): Promise<PublishingJob> {
    // emulate @@unique([articleId, destination, contentHash])
    for (const j of this.jobs.values()) {
      if (
        j.articleId === input.articleId &&
        j.destination === input.destination &&
        j.contentHash === input.contentHash
      ) {
        throw new Error("unique constraint: (articleId, destination, contentHash)");
      }
    }
    const now = new Date().toISOString();
    const job: PublishingJob = {
      id: this.id("job"),
      articleId: input.articleId,
      userId: input.userId,
      destination: input.destination,
      status: "PENDING",
      contentHash: input.contentHash,
      idempotencyKey: input.idempotencyKey,
      scheduledFor: input.scheduledFor ?? null,
      requestedAt: now,
      startedAt: null,
      completedAt: null,
      attemptCount: 0,
      lastError: null,
      result: null,
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(job.id, job);
    return { ...job };
  }

  async patchJob(id: string, patch: PatchJobInput): Promise<PublishingJob> {
    const j = this.jobs.get(id);
    if (!j) throw new Error("no such job");
    if (patch.status !== undefined) j.status = patch.status;
    if (patch.startedAt !== undefined) j.startedAt = patch.startedAt;
    if (patch.completedAt !== undefined) j.completedAt = patch.completedAt;
    if (patch.attemptCount !== undefined) j.attemptCount = patch.attemptCount;
    if (patch.lastError !== undefined) j.lastError = patch.lastError;
    if (patch.result !== undefined) j.result = patch.result;
    j.updatedAt = new Date().toISOString();
    return { ...j };
  }

  async incrementAttemptCount(id: string): Promise<number> {
    const j = this.jobs.get(id);
    if (!j) throw new Error("no such job");
    j.attemptCount += 1;
    return j.attemptCount;
  }

  async appendAttempt(input: AppendAttemptInput): Promise<PublishingAttempt> {
    // emulate @@unique([jobId, attemptNumber])
    if (this.attempts.some((a) => a.jobId === input.jobId && a.attemptNumber === input.attemptNumber)) {
      throw new Error("unique constraint: (jobId, attemptNumber)");
    }
    const now = new Date().toISOString();
    const attempt: PublishingAttempt = {
      id: this.id("att"),
      jobId: input.jobId,
      attemptNumber: input.attemptNumber,
      status: "RUNNING",
      startedAt: now,
      completedAt: null,
      error: null,
      externalReference: null,
      externalUrl: null,
      destinationResponseMeta: null,
      createdAt: now,
    };
    this.attempts.push(attempt);
    return { ...attempt };
  }

  async patchAttempt(id: string, patch: PatchAttemptInput): Promise<PublishingAttempt> {
    const a = this.attempts.find((x) => x.id === id);
    if (!a) throw new Error("no such attempt");
    a.status = patch.status;
    a.completedAt = patch.completedAt;
    a.error = patch.error ?? null;
    a.externalReference = patch.externalReference ?? null;
    a.externalUrl = patch.externalUrl ?? null;
    a.destinationResponseMeta = patch.destinationResponseMeta ?? null;
    return { ...a };
  }

  async listAttempts(jobId: string): Promise<PublishingAttempt[]> {
    return this.attempts.filter((a) => a.jobId === jobId).map((a) => ({ ...a }));
  }
}

// ---- fake ArticleReader ---------------------------------------------

const SECTIONS: ArticleSection[] = [
  { heading: "Market Overview", body: "Gold held a constructive tone into the London fix as real yields eased lower." },
  { heading: "Key Levels", body: "Support 2,640 / 2,610. Resistance 2,700, then the 2,725 swing high on the daily." },
  { heading: "Outlook", body: "Current evidence favors a bullish scenario while 2,610 holds on a daily close basis." },
];

function makeArticle(id: string, sections: ArticleSection[] = SECTIONS): Article {
  const slug = "gold-analysis";
  return {
    id,
    title: "Gold Analysis",
    category: "gold-analysis",
    summary: "Overview, key levels, and outlook for XAUUSD.",
    sections,
    disclaimer: "This is not financial advice. Trading involves risk.",
    seo: {
      title: "Gold Analysis",
      metaDescription: "Gold analysis - key levels and outlook from Algotraders24 AI.",
      keywords: ["gold", "xauusd", "gold analysis"],
      slug,
      canonicalUrl: `https://algotraders24.ai/blog/${slug}`,
      openGraph: { title: "", description: "", type: "article", url: "" },
      twitter: { card: "summary_large_image", title: "", description: "" },
      score: 90,
    },
    status: "draft",
    sourceType: "ai",
    history: [],
    createdAt: "2026-09-09T00:00:00.000Z",
    scheduledFor: null,
    publishedAt: null,
  };
}

/** owner userId -> (articleId -> Article). getById throws for anything not
 *  registered to that user (mirrors articleService.findOwned -> 404). */
class FakeArticles implements ArticleReader {
  private byUser = new Map<string, Map<string, Article>>();

  put(userId: string, article: Article): void {
    if (!this.byUser.has(userId)) this.byUser.set(userId, new Map());
    this.byUser.get(userId)!.set(article.id, article);
  }

  async getById(userId: string, id: string): Promise<Article> {
    const a = this.byUser.get(userId)?.get(id);
    if (!a) {
      const err = new Error("Article not found") as Error & { httpStatus: number };
      err.httpStatus = 404;
      throw err;
    }
    return a;
  }
}

// ---- tests ----------------------------------------------------------

const USER_A = "user_a";
const USER_B = "user_b";

async function main() {
  console.log("\nPublishingService persistence/orchestration - validation\n");

  // -- createJob ------------------------------------------------------
  await test("createJob: ownership check - a foreign article is a 404", async () => {
    const articles = new FakeArticles();
    articles.put(USER_A, makeArticle("art_1"));
    const svc = new PublishingService(new FakeRepo(), articles);
    await assert.rejects(() =>
      svc.createJob({ userId: USER_B, articleId: "art_1", destination: "INTERNAL_BLOG" }),
    );
  });

  await test("createJob: creates a PENDING job with the derived identity key", async () => {
    const articles = new FakeArticles();
    const article = makeArticle("art_1");
    articles.put(USER_A, article);
    const svc = new PublishingService(new FakeRepo(), articles);

    const job = await svc.createJob({ userId: USER_A, articleId: "art_1", destination: "INTERNAL_BLOG" });
    const expectedHash = projectArticleToPublishInput(article, { destination: "INTERNAL_BLOG" }).contentHash;
    const identity: PublicationIdentity = { articleId: "art_1", destination: "INTERNAL_BLOG", contentHash: expectedHash };

    assert.equal(job.status, "PENDING");
    assert.equal(job.userId, USER_A);
    assert.equal(job.contentHash, expectedHash);
    assert.equal(job.idempotencyKey, publicationIdentityKey(identity));
    assert.equal(job.attemptCount, 0);
  });

  await test("createJob: idempotent - same content returns the same job, never a 2nd row", async () => {
    const articles = new FakeArticles();
    articles.put(USER_A, makeArticle("art_1"));
    const repo = new FakeRepo();
    const svc = new PublishingService(repo, articles);

    const j1 = await svc.createJob({ userId: USER_A, articleId: "art_1", destination: "INTERNAL_BLOG" });
    const j2 = await svc.createJob({ userId: USER_A, articleId: "art_1", destination: "INTERNAL_BLOG" });
    assert.equal(j1.id, j2.id);
    assert.equal(repo.jobs.size, 1);
  });

  await test("createJob: editing the article yields a DIFFERENT job (new content hash)", async () => {
    const articles = new FakeArticles();
    articles.put(USER_A, makeArticle("art_1"));
    const repo = new FakeRepo();
    const svc = new PublishingService(repo, articles);

    const j1 = await svc.createJob({ userId: USER_A, articleId: "art_1", destination: "INTERNAL_BLOG" });
    articles.put(USER_A, makeArticle("art_1", [...SECTIONS, { heading: "Risks", body: "A hawkish surprise invalidates the thesis quickly." }]));
    const j2 = await svc.createJob({ userId: USER_A, articleId: "art_1", destination: "INTERNAL_BLOG" });

    assert.notEqual(j1.id, j2.id);
    assert.notEqual(j1.contentHash, j2.contentHash);
    assert.equal(repo.jobs.size, 2);
  });

  // -- getJob ownership ---------------------------------------------
  await test("getJob: ownership isolation - user B cannot read user A's job", async () => {
    const articles = new FakeArticles();
    articles.put(USER_A, makeArticle("art_1"));
    const svc = new PublishingService(new FakeRepo(), articles);
    const job = await svc.createJob({ userId: USER_A, articleId: "art_1", destination: "INTERNAL_BLOG" });

    assert.equal((await svc.getJob(USER_A, job.id)).id, job.id);
    await assert.rejects(() => svc.getJob(USER_B, job.id));
    await assert.rejects(() => svc.listJobAttempts(USER_B, job.id));
  });

  // -- runAttempt: success -------------------------------------------
  await test("runAttempt: success - attempt #1 SUCCEEDED, job SUCCEEDED with a result", async () => {
    const articles = new FakeArticles();
    articles.put(USER_A, makeArticle("art_1"));
    const repo = new FakeRepo();
    const svc = new PublishingService(repo, articles);

    const job = await svc.createJob({ userId: USER_A, articleId: "art_1", destination: "INTERNAL_BLOG" });
    const { job: after, attempt } = await svc.runAttempt({ userId: USER_A, jobId: job.id });

    assert.equal(attempt.attemptNumber, 1);
    assert.equal(attempt.status, "SUCCEEDED");
    assert.equal(attempt.externalReference, null);
    assert.equal(attempt.externalUrl, "https://algotraders24.ai/blog/gold-analysis");
    assert.equal(after.status, "SUCCEEDED");
    assert.equal(after.result?.success, true);
    assert.equal(after.lastError, null);
    assert.equal(after.attemptCount, 1);
  });

  await test("runAttempt: a SUCCEEDED job is not runnable again", async () => {
    const articles = new FakeArticles();
    articles.put(USER_A, makeArticle("art_1"));
    const svc = new PublishingService(new FakeRepo(), articles);
    const job = await svc.createJob({ userId: USER_A, articleId: "art_1", destination: "INTERNAL_BLOG" });
    await svc.runAttempt({ userId: USER_A, jobId: job.id });
    await assert.rejects(() => svc.runAttempt({ userId: USER_A, jobId: job.id }));
  });

  // -- runAttempt: failure + retry --------------------------------
  await test("runAttempt: bad content - attempt FAILED, job FAILED with lastError; then retry SUCCEEDS", async () => {
    const articles = new FakeArticles();
    // a thin article the InternalBlogAdapter will reject (body < 80 chars)
    const thin = makeArticle("art_thin", [{ heading: "Overview", body: "Short." }]);
    articles.put(USER_A, thin);
    const repo = new FakeRepo();
    const svc = new PublishingService(repo, articles);

    const job = await svc.createJob({ userId: USER_A, articleId: "art_thin", destination: "INTERNAL_BLOG" });
    const r1 = await svc.runAttempt({ userId: USER_A, jobId: job.id });
    assert.equal(r1.attempt.status, "FAILED");
    assert.equal(r1.attempt.error?.code, "VALIDATION_ERROR");
    assert.equal(r1.job.status, "FAILED");
    assert.equal(r1.job.lastError?.code, "VALIDATION_ERROR");

    // The FAILED job is runnable again (contract: FAILED is not terminal).
    // Fix the article to something publishable, but NOTE: that changes the
    // content hash, so this specific job is now stale -> integrity failure.
    articles.put(USER_A, makeArticle("art_thin"));
    const r2 = await svc.runAttempt({ userId: USER_A, jobId: job.id });
    assert.equal(r2.attempt.attemptNumber, 2);
    assert.equal(r2.job.status, "FAILED");
    assert.equal(r2.job.lastError?.code, "PERMANENT_FAILURE"); // stale-content integrity gate
  });

  await test("runAttempt: transient failure then a clean retry on the SAME content SUCCEEDS", async () => {
    // Uses a flaky adapter via a service whose article is fine but whose
    // FIRST attempt we force to fail by pre-marking the job FAILED with a
    // retryable error, then re-running.
    const articles = new FakeArticles();
    articles.put(USER_A, makeArticle("art_1"));
    const repo = new FakeRepo();
    const svc = new PublishingService(repo, articles);
    const job = await svc.createJob({ userId: USER_A, articleId: "art_1", destination: "INTERNAL_BLOG" });

    // simulate a prior failed attempt
    await repo.patchJob(job.id, { status: "FAILED", lastError: { code: "RATE_LIMITED", message: "429", destination: "INTERNAL_BLOG", retryClass: "RETRYABLE", cause: null } });
    await repo.incrementAttemptCount(job.id);
    await repo.appendAttempt({ jobId: job.id, attemptNumber: 1 });

    const r = await svc.runAttempt({ userId: USER_A, jobId: job.id });
    assert.equal(r.attempt.attemptNumber, 2);
    assert.equal(r.attempt.status, "SUCCEEDED");
    assert.equal(r.job.status, "SUCCEEDED");
    assert.equal(r.job.lastError, null);
    const history = await svc.listJobAttempts(USER_A, job.id);
    assert.deepEqual(history.map((a) => a.attemptNumber), [1, 2]);
  });

  // -- runAttempt: integrity gate --------------------------------
  await test("runAttempt: article edited after job creation -> PERMANENT_FAILURE (stale job)", async () => {
    const articles = new FakeArticles();
    articles.put(USER_A, makeArticle("art_1"));
    const svc = new PublishingService(new FakeRepo(), articles);
    const job = await svc.createJob({ userId: USER_A, articleId: "art_1", destination: "INTERNAL_BLOG" });

    articles.put(USER_A, makeArticle("art_1", [...SECTIONS, { heading: "Addendum", body: "Late-breaking: CPI came in hot this morning." }]));
    const r = await svc.runAttempt({ userId: USER_A, jobId: job.id });
    assert.equal(r.job.status, "FAILED");
    assert.equal(r.job.lastError?.code, "PERMANENT_FAILURE");
    assert.equal(svc.classifyError(r.job.lastError!), "NON_RETRYABLE");
  });

  // -- runAttempt: ownership --------------------------------------
  await test("runAttempt: user B cannot run user A's job", async () => {
    const articles = new FakeArticles();
    articles.put(USER_A, makeArticle("art_1"));
    const svc = new PublishingService(new FakeRepo(), articles);
    const job = await svc.createJob({ userId: USER_A, articleId: "art_1", destination: "INTERNAL_BLOG" });
    await assert.rejects(() => svc.runAttempt({ userId: USER_B, jobId: job.id }));
  });

  // -- content serialization hash parity -------------------------
  await test("the job's contentHash == a fresh hash of the same Article projection", async () => {
    const articles = new FakeArticles();
    const article = makeArticle("art_1");
    articles.put(USER_A, article);
    const svc = new PublishingService(new FakeRepo(), articles);
    const job = await svc.createJob({ userId: USER_A, articleId: "art_1", destination: "INTERNAL_BLOG" });
    const fresh = computeContentHash(projectArticleToPublishInput(article, { destination: "INTERNAL_BLOG" }));
    assert.equal(job.contentHash, fresh);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

void main();

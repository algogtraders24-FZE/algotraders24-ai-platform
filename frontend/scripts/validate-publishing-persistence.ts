// scripts/validate-publishing-persistence.ts
// AT24 Publishing Engine - PublishingService orchestration over in-memory
// fakes (repository + Article store + audit sink). No DB, no network. Proves
// the lifecycle / idempotency / ownership / integrity logic (P2.2) plus the
// P2.3 additions: the SUCCEEDED-job -> Article `published` transaction, the
// audit events, the 3-attempt cap, auto-retry eligibility, and the
// dispatcher batch.
//
// House test pattern (node:assert/strict). Run:
//   npm run validate:publishing-persistence

import assert from "node:assert/strict";

import type { Article, ArticleSection } from "../types/article";
import {
  publicationIdentityKey,
  type PublishError,
  type PublishingAttempt,
  type PublishingJob,
  type PublicationIdentity,
} from "../types/publishing";

import { projectArticleToPublishInput } from "../services/publishing/article-serializer";
import {
  PublishingService,
  MAX_PUBLISH_ATTEMPTS,
  type ArticleReader,
  type PublishingAuditSink,
} from "../services/publishing/publishing.service";
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

// ---- fake Article store (getById gate + a real publish mutation) --------

class FakeArticleStore implements ArticleReader {
  private byUser = new Map<string, Map<string, Article>>();

  put(userId: string, article: Article): void {
    if (!this.byUser.has(userId)) this.byUser.set(userId, new Map());
    this.byUser.get(userId)!.set(article.id, article);
  }

  private find(articleId: string): { userId: string; article: Article } | null {
    for (const [userId, m] of this.byUser) {
      const a = m.get(articleId);
      if (a) return { userId, article: a };
    }
    return null;
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

  /** Emulates the tx.article.update inside PublishingRepository.commitSuccess. */
  markPublished(articleId: string): boolean {
    const hit = this.find(articleId);
    if (!hit || hit.article.status === "published") return false;
    hit.article.status = "published";
    hit.article.publishedAt = new Date().toISOString();
    return true;
  }

  status(articleId: string): string | null {
    return this.find(articleId)?.article.status ?? null;
  }
}

// ---- fake repository --------------------------------------------------

class FakeRepo implements PublishingRepository {
  jobs = new Map<string, PublishingJob>();
  attempts: PublishingAttempt[] = [];
  private seq = 0;

  constructor(private readonly articles: FakeArticleStore) {}

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
    for (const j of this.jobs.values()) {
      if (j.articleId === input.articleId && j.destination === input.destination && j.contentHash === input.contentHash) {
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

  // --- P2.3 transactional commits (emulated atomically) ---

  async commitSuccess(params: {
    jobId: string;
    attemptId: string;
    result: PublishingJob["result"];
    completedAt: string;
    externalReference: string | null;
    externalUrl: string | null;
    destinationResponseMeta: Record<string, unknown> | null;
    publishArticle: { articleId: string; actorUserId: string; jobId: string } | null;
  }): Promise<{ job: PublishingJob; attempt: PublishingAttempt; articlePublished: boolean }> {
    const attempt = await this.patchAttempt(params.attemptId, {
      status: "SUCCEEDED",
      completedAt: params.completedAt,
      externalReference: params.externalReference,
      externalUrl: params.externalUrl,
      destinationResponseMeta: params.destinationResponseMeta,
    });
    const job = await this.patchJob(params.jobId, {
      status: "SUCCEEDED",
      completedAt: params.completedAt,
      result: params.result ?? null,
      lastError: null,
    });
    let articlePublished = false;
    if (params.publishArticle) {
      articlePublished = this.articles.markPublished(params.publishArticle.articleId);
    }
    return { job, attempt, articlePublished };
  }

  async commitFailure(params: {
    jobId: string;
    attemptId: string;
    error: PublishError;
    completedAt: string;
  }): Promise<{ job: PublishingJob; attempt: PublishingAttempt }> {
    const attempt = await this.patchAttempt(params.attemptId, {
      status: "FAILED",
      completedAt: params.completedAt,
      error: params.error,
    });
    const job = await this.patchJob(params.jobId, {
      status: "FAILED",
      completedAt: params.completedAt,
      lastError: params.error,
    });
    return { job, attempt };
  }

  async findDispatchableJobs(limit: number, maxAttempts: number): Promise<PublishingJob[]> {
    const now = Date.now();
    return [...this.jobs.values()]
      .filter((j) => {
        if (j.scheduledFor && Date.parse(j.scheduledFor) > now) return false;
        if (j.status === "PENDING") return true;
        return (
          j.status === "FAILED" && j.attemptCount < maxAttempts && j.lastError?.retryClass === "RETRYABLE"
        );
      })
      .sort((a, b) => Date.parse(a.requestedAt) - Date.parse(b.requestedAt))
      .slice(0, limit)
      .map((j) => ({ ...j }));
  }

  // P2.5 blog-reader methods - not exercised by the PublishingService tests
  // here (they have their own suite, validate-publishing-blog-reader.ts).
  async listPublishedInternalBlogRecords() {
    return [];
  }
  async findPublishedInternalBlogRecordBySlug() {
    return null;
  }
}

// ---- fake audit sink -----------------------------------------------

class FakeAudit implements PublishingAuditSink {
  events: { action: string; actorUserId: string; targetId?: string; metadata?: Record<string, unknown> }[] = [];
  async record(p: {
    actorUserId: string;
    action: "article.published" | "article.publish_failed";
    targetType: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    this.events.push({ action: p.action, actorUserId: p.actorUserId, targetId: p.targetId, metadata: p.metadata });
  }
}

// ---- fixtures -----------------------------------------------------

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

const USER_A = "user_a";
const USER_B = "user_b";

function wire(seed?: { userId?: string; article?: Article }) {
  const articles = new FakeArticleStore();
  if (seed?.article) articles.put(seed.userId ?? USER_A, seed.article);
  const repo = new FakeRepo(articles);
  const audit = new FakeAudit();
  const svc = new PublishingService(repo, articles, audit);
  return { articles, repo, audit, svc };
}

const RETRYABLE_ERR: PublishError = {
  code: "RATE_LIMITED",
  message: "429 Too Many Requests",
  destination: "INTERNAL_BLOG",
  retryClass: "RETRYABLE",
  cause: null,
};

// ---- tests ------------------------------------------------------

async function main() {
  console.log("\nPublishingService persistence + lifecycle - validation\n");

  // === P2.2: createJob ===
  await test("createJob: a foreign article is a 404", async () => {
    const { svc } = wire({ article: makeArticle("art_1") });
    await assert.rejects(() => svc.createJob({ userId: USER_B, articleId: "art_1", destination: "INTERNAL_BLOG" }));
  });

  await test("createJob: PENDING job with the derived identity key", async () => {
    const article = makeArticle("art_1");
    const { svc } = wire({ article });
    const job = await svc.createJob({ userId: USER_A, articleId: "art_1", destination: "INTERNAL_BLOG" });
    const hash = projectArticleToPublishInput(article, { destination: "INTERNAL_BLOG" }).contentHash;
    const identity: PublicationIdentity = { articleId: "art_1", destination: "INTERNAL_BLOG", contentHash: hash };
    assert.equal(job.status, "PENDING");
    assert.equal(job.contentHash, hash);
    assert.equal(job.idempotencyKey, publicationIdentityKey(identity));
    assert.equal(job.attemptCount, 0);
  });

  await test("createJob: idempotent - same content = same job, no 2nd row", async () => {
    const { svc, repo } = wire({ article: makeArticle("art_1") });
    const j1 = await svc.createJob({ userId: USER_A, articleId: "art_1", destination: "INTERNAL_BLOG" });
    const j2 = await svc.createJob({ userId: USER_A, articleId: "art_1", destination: "INTERNAL_BLOG" });
    assert.equal(j1.id, j2.id);
    assert.equal(repo.jobs.size, 1);
  });

  await test("createJob: editing the article yields a different job", async () => {
    const { svc, repo, articles } = wire({ article: makeArticle("art_1") });
    const j1 = await svc.createJob({ userId: USER_A, articleId: "art_1", destination: "INTERNAL_BLOG" });
    articles.put(USER_A, makeArticle("art_1", [...SECTIONS, { heading: "Risks", body: "A hawkish surprise invalidates the thesis quickly." }]));
    const j2 = await svc.createJob({ userId: USER_A, articleId: "art_1", destination: "INTERNAL_BLOG" });
    assert.notEqual(j1.id, j2.id);
    assert.notEqual(j1.contentHash, j2.contentHash);
    assert.equal(repo.jobs.size, 2);
  });

  await test("getJob: ownership isolation - user B cannot read user A's job", async () => {
    const { svc } = wire({ article: makeArticle("art_1") });
    const job = await svc.createJob({ userId: USER_A, articleId: "art_1", destination: "INTERNAL_BLOG" });
    assert.equal((await svc.getJob(USER_A, job.id)).id, job.id);
    await assert.rejects(() => svc.getJob(USER_B, job.id));
    await assert.rejects(() => svc.listJobAttempts(USER_B, job.id));
  });

  // === P2.2/P2.3: runAttempt success + drift close ===
  await test("runAttempt success: attempt#1 + job SUCCEEDED, AND the Article -> published (drift closed)", async () => {
    const { svc, articles, audit } = wire({ article: makeArticle("art_1") });
    const job = await svc.createJob({ userId: USER_A, articleId: "art_1", destination: "INTERNAL_BLOG" });
    assert.equal(articles.status("art_1"), "draft");

    const { job: after, attempt } = await svc.runAttempt({ userId: USER_A, jobId: job.id });

    assert.equal(attempt.attemptNumber, 1);
    assert.equal(attempt.status, "SUCCEEDED");
    assert.equal(attempt.externalUrl, "https://algotraders24.ai/blog/gold-analysis");
    assert.equal(after.status, "SUCCEEDED");
    assert.equal(after.result?.success, true);
    assert.equal(after.lastError, null);
    // P2.3-B: the source Article is now published (and therefore read-only).
    assert.equal(articles.status("art_1"), "published");
    // P2.3-C: exactly one article.published audit event.
    const pub = audit.events.filter((e) => e.action === "article.published");
    assert.equal(pub.length, 1);
    assert.equal(pub[0].targetId, "art_1");
    assert.equal(pub[0].metadata?.articleStatusChanged, true);
  });

  await test("commitSuccess is idempotent on an already-published Article (articleStatusChanged=false)", async () => {
    const { svc, repo, articles, audit } = wire({ article: makeArticle("art_1") });
    const job = await svc.createJob({ userId: USER_A, articleId: "art_1", destination: "INTERNAL_BLOG" });
    articles.markPublished("art_1"); // pretend a prior publish already flipped it
    await svc.runAttempt({ userId: USER_A, jobId: job.id });
    assert.equal(repo.jobs.get(job.id)!.status, "SUCCEEDED");
    const pub = audit.events.filter((e) => e.action === "article.published");
    assert.equal(pub.length, 1);
    assert.equal(pub[0].metadata?.articleStatusChanged, false); // was already published
  });

  await test("runAttempt: a SUCCEEDED job is not runnable again", async () => {
    const { svc } = wire({ article: makeArticle("art_1") });
    const job = await svc.createJob({ userId: USER_A, articleId: "art_1", destination: "INTERNAL_BLOG" });
    await svc.runAttempt({ userId: USER_A, jobId: job.id });
    await assert.rejects(() => svc.runAttempt({ userId: USER_A, jobId: job.id }));
  });

  // === P2.3-B: failure does NOT publish the article ===
  await test("runAttempt failure: bad content -> job FAILED, Article stays draft, article.publish_failed audited", async () => {
    const { svc, articles, audit } = wire({ article: makeArticle("art_thin", [{ heading: "Overview", body: "Short." }]) });
    const job = await svc.createJob({ userId: USER_A, articleId: "art_thin", destination: "INTERNAL_BLOG" });
    const { job: after, attempt } = await svc.runAttempt({ userId: USER_A, jobId: job.id });
    assert.equal(after.status, "FAILED");
    assert.equal(after.lastError?.code, "VALIDATION_ERROR");
    assert.equal(attempt.status, "FAILED");
    assert.equal(articles.status("art_thin"), "draft"); // NEVER published on failure
    const fail = audit.events.filter((e) => e.action === "article.publish_failed");
    assert.equal(fail.length, 1);
    assert.equal(fail[0].metadata?.errorCode, "VALIDATION_ERROR");
    assert.equal(audit.events.some((e) => e.action === "article.published"), false);
  });

  // === P2.3: integrity gate ===
  await test("runAttempt: article edited after job creation -> PERMANENT_FAILURE, no publish", async () => {
    const { svc, articles } = wire({ article: makeArticle("art_1") });
    const job = await svc.createJob({ userId: USER_A, articleId: "art_1", destination: "INTERNAL_BLOG" });
    articles.put(USER_A, makeArticle("art_1", [...SECTIONS, { heading: "Addendum", body: "Late-breaking: CPI came in hot this morning, changing the picture." }]));
    const { job: after } = await svc.runAttempt({ userId: USER_A, jobId: job.id });
    assert.equal(after.status, "FAILED");
    assert.equal(after.lastError?.code, "PERMANENT_FAILURE");
    assert.equal(svc.classifyError(after.lastError!), "NON_RETRYABLE");
    assert.equal(articles.status("art_1"), "draft");
  });

  await test("runAttempt: user B cannot run user A's job", async () => {
    const { svc } = wire({ article: makeArticle("art_1") });
    const job = await svc.createJob({ userId: USER_A, articleId: "art_1", destination: "INTERNAL_BLOG" });
    await assert.rejects(() => svc.runAttempt({ userId: USER_B, jobId: job.id }));
  });

  // === P2.3-D: attempt cap ===
  await test(`runAttempt: hard cap at ${MAX_PUBLISH_ATTEMPTS} attempts`, async () => {
    const { svc, repo, articles } = wire({ article: makeArticle("art_1") });
    const job = await svc.createJob({ userId: USER_A, articleId: "art_1", destination: "INTERNAL_BLOG" });
    // drive attemptCount to the cap with retryable failures (article unchanged so
    // the integrity gate passes; adapter succeeds - so instead we simulate prior
    // failed attempts directly)
    const j = repo.jobs.get(job.id)!;
    j.status = "FAILED";
    j.attemptCount = MAX_PUBLISH_ATTEMPTS;
    j.lastError = RETRYABLE_ERR;
    await assert.rejects(
      () => svc.runAttempt({ userId: USER_A, jobId: job.id }),
      /maximum of 3 attempts/,
    );
    assert.equal(articles.status("art_1"), "draft");
  });

  // === P2.3-D: auto-retry eligibility ===
  await test("isEligibleForAutoRetry: only RETRYABLE + under the cap", async () => {
    const { svc } = wire();
    const base: PublishingJob = {
      id: "j", articleId: "a", userId: USER_A, destination: "INTERNAL_BLOG", status: "FAILED",
      contentHash: "0".repeat(64), idempotencyKey: "k", scheduledFor: null, requestedAt: "2026-09-09T00:00:00.000Z",
      startedAt: null, completedAt: null, attemptCount: 1, lastError: RETRYABLE_ERR, result: null,
      createdAt: "2026-09-09T00:00:00.000Z", updatedAt: "2026-09-09T00:00:00.000Z",
    };
    assert.equal(svc.isEligibleForAutoRetry(base), true);
    assert.equal(svc.isEligibleForAutoRetry({ ...base, attemptCount: MAX_PUBLISH_ATTEMPTS }), false);
    assert.equal(svc.isEligibleForAutoRetry({ ...base, status: "PENDING" }), false);
    assert.equal(
      svc.isEligibleForAutoRetry({ ...base, lastError: { ...RETRYABLE_ERR, code: "VALIDATION_ERROR", retryClass: "NON_RETRYABLE" } }),
      false,
    );
    assert.equal(
      svc.isEligibleForAutoRetry({ ...base, lastError: { ...RETRYABLE_ERR, code: "DUPLICATE", retryClass: "IDEMPOTENT_DUPLICATE" } }),
      false,
    );
  });

  // === P2.3-E: dispatcher ===
  await test("dispatch: runs PENDING jobs and reports outcomes", async () => {
    const { svc, articles } = wire();
    articles.put(USER_A, makeArticle("art_ok"));
    articles.put(USER_B, makeArticle("art_thin", [{ heading: "Overview", body: "Short." }]));
    const ok = await svc.createJob({ userId: USER_A, articleId: "art_ok", destination: "INTERNAL_BLOG" });
    const bad = await svc.createJob({ userId: USER_B, articleId: "art_thin", destination: "INTERNAL_BLOG" });

    const report = await svc.dispatch();
    assert.equal(report.scanned, 2);
    assert.equal(report.ran, 2);
    const byId = new Map(report.results.map((r) => [r.jobId, r.outcome]));
    assert.equal(byId.get(ok.id), "SUCCEEDED");
    assert.equal(byId.get(bad.id), "FAILED");
    assert.equal(articles.status("art_ok"), "published");
  });

  await test("dispatch: retries a retryable FAILED job, skips a non-retryable one and an exhausted one", async () => {
    const { svc, repo, articles } = wire();
    articles.put(USER_A, makeArticle("art_ok"));
    const retryable = await svc.createJob({ userId: USER_A, articleId: "art_ok", destination: "INTERNAL_BLOG" });
    // make it a retryable FAILED with 1 prior attempt
    Object.assign(repo.jobs.get(retryable.id)!, { status: "FAILED", attemptCount: 1, lastError: RETRYABLE_ERR });

    articles.put(USER_B, makeArticle("art_b"));
    const nonRetryable = await svc.createJob({ userId: USER_B, articleId: "art_b", destination: "INTERNAL_BLOG" });
    Object.assign(repo.jobs.get(nonRetryable.id)!, {
      status: "FAILED", attemptCount: 1,
      lastError: { code: "VALIDATION_ERROR", message: "bad", destination: "INTERNAL_BLOG", retryClass: "NON_RETRYABLE", cause: null },
    });

    articles.put("user_c", makeArticle("art_c"));
    const exhausted = await svc.createJob({ userId: "user_c", articleId: "art_c", destination: "INTERNAL_BLOG" });
    Object.assign(repo.jobs.get(exhausted.id)!, { status: "FAILED", attemptCount: MAX_PUBLISH_ATTEMPTS, lastError: RETRYABLE_ERR });

    const report = await svc.dispatch();
    const ran = new Set(report.results.map((r) => r.jobId));
    assert.equal(ran.has(retryable.id), true);
    assert.equal(ran.has(nonRetryable.id), false);
    assert.equal(ran.has(exhausted.id), false);
    assert.equal(repo.jobs.get(retryable.id)!.status, "SUCCEEDED"); // content valid -> the retry works
  });

  await test("dispatch: respects the batch limit", async () => {
    const { svc, articles } = wire();
    for (let i = 0; i < 5; i++) {
      articles.put(`u${i}`, makeArticle(`art_${i}`));
      await svc.createJob({ userId: `u${i}`, articleId: `art_${i}`, destination: "INTERNAL_BLOG" });
    }
    const report = await svc.dispatch({ limit: 2 });
    assert.equal(report.scanned, 2);
  });

  // === P2.4: scheduling ===
  await test("createJob (immediate / omitted): scheduledFor is null, job dispatches now", async () => {
    const { svc, repo, articles } = wire({ article: makeArticle("art_1") });
    const jobA = await svc.createJob({ userId: USER_A, articleId: "art_1", destination: "INTERNAL_BLOG" });
    assert.equal(jobA.scheduledFor, null);
    assert.equal(repo.jobs.get(jobA.id)!.scheduledFor, null);

    articles.put(USER_A, makeArticle("art_2"));
    const jobB = await svc.createJob({
      userId: USER_A, articleId: "art_2", destination: "INTERNAL_BLOG", schedule: { kind: "immediate" },
    });
    assert.equal(jobB.scheduledFor, null);

    const report = await svc.dispatch();
    assert.equal(report.scanned, 2); // both picked up
  });

  await test("createJob (slot): scheduledFor is a future UTC instant, dispatcher SKIPS it", async () => {
    const { svc, repo } = wire({ article: makeArticle("art_1") });
    const job = await svc.createJob({
      userId: USER_A, articleId: "art_1", destination: "INTERNAL_BLOG", schedule: { kind: "slot", slot: "00:00" },
    });
    assert.ok(job.scheduledFor && Date.parse(job.scheduledFor) > Date.now(), "scheduledFor is in the future");
    assert.match(job.scheduledFor!, /T00:00:00\.000Z$/, "aligned to the 00:00 UTC slot");
    assert.equal(repo.jobs.get(job.id)!.status, "PENDING");

    const report = await svc.dispatch();
    assert.equal(report.scanned, 0); // future job is not due
    assert.equal(repo.jobs.get(job.id)!.status, "PENDING"); // untouched
  });

  await test("a job whose scheduledFor has passed IS dispatched", async () => {
    const { svc, repo, articles } = wire({ article: makeArticle("art_1") });
    const job = await svc.createJob({
      userId: USER_A, articleId: "art_1", destination: "INTERNAL_BLOG", schedule: { kind: "slot", slot: "12:00" },
    });
    // simulate the slot time having arrived
    repo.jobs.get(job.id)!.scheduledFor = new Date(Date.now() - 60_000).toISOString();

    const report = await svc.dispatch();
    assert.equal(report.scanned, 1);
    assert.equal(report.results[0].outcome, "SUCCEEDED");
    assert.equal(articles.status("art_1"), "published");
  });

  await test("createJob: an existing (idempotent) job keeps its original schedule", async () => {
    const { svc, repo } = wire({ article: makeArticle("art_1") });
    const first = await svc.createJob({
      userId: USER_A, articleId: "art_1", destination: "INTERNAL_BLOG", schedule: { kind: "slot", slot: "00:00" },
    });
    const again = await svc.createJob({
      userId: USER_A, articleId: "art_1", destination: "INTERNAL_BLOG", schedule: { kind: "immediate" },
    });
    assert.equal(again.id, first.id);
    assert.equal(again.scheduledFor, first.scheduledFor); // NOT rescheduled to immediate
    assert.equal(repo.jobs.size, 1);
  });

  // === P2.5: publishArticleNow (legacy "Publish now" route, rewired) ===
  await test("publishArticleNow: creates a job, runs it, Article -> published, visible-ready", async () => {
    const { svc, articles, repo } = wire({ article: makeArticle("art_1") });
    const { job } = await svc.publishArticleNow(USER_A, "art_1");
    assert.equal(job.status, "SUCCEEDED");
    assert.equal(job.destination, "INTERNAL_BLOG");
    assert.equal(articles.status("art_1"), "published");
    assert.equal(repo.jobs.size, 1); // a REAL job now exists (not a bare status flip)
  });

  await test("publishArticleNow: keeps the validateArticle pre-gate (thin article rejected, no job)", async () => {
    const { svc, repo } = wire({ article: makeArticle("art_thin", [{ heading: "Only one", body: "too thin" }]) });
    await assert.rejects(() => svc.publishArticleNow(USER_A, "art_thin"), /not ready to publish/);
    assert.equal(repo.jobs.size, 0);
  });

  await test("publishArticleNow: idempotent - a second call returns the already-SUCCEEDED job", async () => {
    const { svc, repo } = wire({ article: makeArticle("art_1") });
    const a = await svc.publishArticleNow(USER_A, "art_1");
    const b = await svc.publishArticleNow(USER_A, "art_1");
    assert.equal(a.job.id, b.job.id);
    assert.equal(b.job.status, "SUCCEEDED");
    assert.equal(repo.jobs.size, 1);
  });

  await test("publishArticleNow: ownership - user B cannot publish user A's article", async () => {
    const { svc } = wire({ article: makeArticle("art_1") });
    await assert.rejects(() => svc.publishArticleNow(USER_B, "art_1"));
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

void main();

// services/publishing/publishing.service.ts
// AT24 Publishing Engine (P2.2) - central orchestration over the P2.1
// contract. Owns:
//   - lifecycle (PublishingJob / PublishingAttempt status transitions)
//   - the idempotency identity (articleId + destination + contentHash)
//   - the AUTHORIZATION boundary (every entry point resolves the Article by
//     (id, userId) BEFORE anything else - the existing articleService
//     ownership guard)
//   - PublishError -> retry classification
//
// The adapter owns destination-specific work ONLY. It never sees a job, an
// attempt, a userId, or a session (Sprint P2.1 §16). This module is the seam
// P2.3 (retry/dispatch), P2.4 (scheduling) and future Automation/Agent
// callers plug into - none of them re-implement lifecycle or idempotency.
//
// No route / server-action / cron code here - those call INTO this service.

import { Errors } from "@/services/backend/ErrorHandler";
import { auditLogService } from "@/services/admin/AuditLogService";
import { articleService } from "./article.service";
import type { Article } from "@/types/article";
import { projectArticleToPublishInput } from "./article-serializer";
import { computeContentHash } from "./content-hash";
import { getDestinationAdapter } from "./destinations/registry";
import { publishingRepository, type PublishingRepository } from "./publishing.repository";
import {
  ARTICLE_STATUS_ON_JOB_SUCCESS,
  isValidJobTransition,
  makePublishError,
  publicationIdentityKey,
  retryClassFor,
  isPublishError,
  type PublicationIdentity,
  type PublishError,
  type PublishRetryClass,
  type PublishResult,
  type PublishingAttempt,
  type PublishingDestinationId,
  type PublishingJob,
  type PublishingJobStatus,
} from "@/types/publishing";

/** Audit sink. Optional + injectable so the service is testable without a DB;
 *  in production it is the real append-only AuditLogService. */
export interface PublishingAuditSink {
  record(params: {
    actorUserId: string;
    action: "article.published" | "article.publish_failed";
    targetType: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

export interface CreateJobParams {
  /** From the server session - never a request body (Sprint P2.1 §14). */
  userId: string;
  articleId: string;
  destination: PublishingDestinationId;
}

export interface RunAttemptParams {
  userId: string;
  jobId: string;
}

export interface RunAttemptResult {
  job: PublishingJob;
  attempt: PublishingAttempt;
}

/** Job statuses from which a (new) execution attempt may start. */
const RUNNABLE_JOB_STATUSES: readonly PublishingJobStatus[] = ["PENDING", "FAILED"];

/** Sprint P2.3-D: hard cap on attempts per job. The dispatcher stops
 *  auto-retrying a job at this count; runAttempt() refuses beyond it. A job
 *  that exhausts its attempts needs a new job (edit the article -> new
 *  contentHash -> new identity). */
export const MAX_PUBLISH_ATTEMPTS = 3;

/** Default batch size for one dispatcher invocation - small enough to finish
 *  well inside a 60s serverless budget even if every job runs an adapter. */
const DEFAULT_DISPATCH_LIMIT = 25;
const MAX_DISPATCH_LIMIT = 100;

/** The narrow slice of ArticleService this module needs. `getById(userId, id)`
 *  is the ownership gate - it throws a 404-mapped AppError for an Article the
 *  caller does not own (never leaks another user's row). Injectable so the
 *  service is testable without a database. */
export interface ArticleReader {
  getById(userId: string, id: string): Promise<Article>;
}

export interface DispatchResult {
  jobId: string;
  outcome: "SUCCEEDED" | "FAILED" | "ERROR";
  detail?: string;
}

export interface DispatchReport {
  scanned: number;
  ran: number;
  results: DispatchResult[];
}

export class PublishingService {
  constructor(
    private readonly repo: PublishingRepository = publishingRepository,
    private readonly articles: ArticleReader = articleService,
    private readonly audit: PublishingAuditSink | null = null,
  ) {}

  // ---- createJob ------------------------------------------------------

  /**
   * Idempotent. Resolves the Article (ownership check), projects it into a
   * NormalizedPublishInput to derive the content hash, then returns the
   * existing job for this publication identity if one exists, or creates a
   * fresh PENDING job.
   *
   * Does NOT validate publishable content or run the adapter - that is
   * runAttempt()'s job (matches the Sprint P2.2 §4 flow).
   */
  async createJob(params: CreateJobParams): Promise<PublishingJob> {
    const article = await this.articles.getById(params.userId, params.articleId); // 404 if not owned

    const input = projectArticleToPublishInput(article, { destination: params.destination });
    const identity: PublicationIdentity = {
      articleId: article.id,
      destination: params.destination,
      contentHash: input.contentHash,
    };

    const existing = await this.repo.findJobByIdentity(identity);
    if (existing) {
      // Idempotency (Sprint P2.1 §11): the same content, same destination =
      // the same logical publication. Return whatever state it is in - the
      // caller decides whether to runAttempt() (PENDING/FAILED) or leave it
      // (RUNNING/SUCCEEDED/CANCELLED). Never a second row (the @@unique index
      // would reject it anyway).
      return existing;
    }

    return this.repo.createJob({
      articleId: article.id,
      userId: params.userId,
      destination: params.destination,
      contentHash: input.contentHash,
      idempotencyKey: publicationIdentityKey(identity),
    });
  }

  // ---- reads (ownership-scoped) --------------------------------------

  async getJob(userId: string, jobId: string): Promise<PublishingJob> {
    const job = await this.repo.findJobForUser(jobId, userId);
    if (!job) throw Errors.notFound("PublishingJob");
    return job;
  }

  async listJobAttempts(userId: string, jobId: string): Promise<PublishingAttempt[]> {
    await this.getJob(userId, jobId); // ownership gate
    return this.repo.listAttempts(jobId);
  }

  async listJobsForArticle(userId: string, articleId: string): Promise<PublishingJob[]> {
    await this.articles.getById(userId, articleId); // 404 if not owned
    return this.repo.listJobsForArticle(articleId, userId);
  }

  // ---- runAttempt ---------------------------------------------------

  /**
   * Execute one attempt of a job. Loads job + Article (ownership), verifies
   * the Article's current content still hashes to the job's contentHash
   * (integrity), transitions the job to RUNNING, creates an Attempt, calls
   * the adapter, and records the outcome on both rows.
   *
   * The adapter is called with a NormalizedPublishInput and nothing else.
   */
  async runAttempt(params: RunAttemptParams): Promise<RunAttemptResult> {
    const job = await this.getJob(params.userId, params.jobId); // ownership

    if (!RUNNABLE_JOB_STATUSES.includes(job.status)) {
      throw Errors.conflict(`PublishingJob is "${job.status}" - not runnable`, { status: job.status });
    }
    if (job.attemptCount >= MAX_PUBLISH_ATTEMPTS) {
      throw Errors.conflict(
        `PublishingJob has reached the maximum of ${MAX_PUBLISH_ATTEMPTS} attempts - create a new job for the updated content`,
        { attemptCount: job.attemptCount },
      );
    }

    const article = await this.articles.getById(params.userId, job.articleId);
    const input = projectArticleToPublishInput(article, { destination: job.destination });

    // Integrity (Sprint P2.2 §4): the job pins a content VERSION. If the
    // Article changed since the job was created, this job is stale - a new
    // job (new hash) must be created. Non-retryable.
    if (computeContentHash(input) !== job.contentHash) {
      return this.failJob(
        job,
        makePublishError(
          "PERMANENT_FAILURE",
          "Article content changed since this publishing job was created - create a new job for the updated content.",
          { destination: job.destination },
        ),
        params.userId,
      );
    }

    // job -> RUNNING
    this.assertTransition(job.status, "RUNNING");
    const startedAt = new Date().toISOString();
    await this.repo.patchJob(job.id, { status: "RUNNING", startedAt });
    const attemptNumber = await this.repo.incrementAttemptCount(job.id);
    const attempt = await this.repo.appendAttempt({ jobId: job.id, attemptNumber });

    const adapter = getDestinationAdapter(job.destination);

    // pre-flight validate - a failed validate is a terminal, non-retryable
    // attempt (never throws for an expected rejection)
    const pre = await adapter.validate(input);
    if (!pre.valid) {
      const err = pre.errors[0] ?? makePublishError("VALIDATION_ERROR", "content rejected by destination", {
        destination: job.destination,
      });
      return this.recordFailure(job, attempt, err, params.userId);
    }

    // publish
    try {
      const result = await adapter.publish(input);
      return this.recordSuccess(job, attempt, result, params.userId);
    } catch (raw) {
      const err = this.normalizeThrown(raw, job.destination);
      if (err.code === "DUPLICATE") {
        // IDEMPOTENT_DUPLICATE (Sprint P2.1 §14): the destination already has
        // this exact content version. Reconcile to a success, do not retry.
        const reconciled: PublishResult = {
          success: true,
          destination: job.destination,
          externalReference: null,
          externalUrl: input.canonicalUrl,
          publishedAt: new Date().toISOString(),
        };
        return this.recordSuccess(job, attempt, reconciled, params.userId, { reconciledFromDuplicate: true });
      }
      return this.recordFailure(job, attempt, err, params.userId);
    }
  }

  /** Public helper for P2.3 dispatch logic: is this error worth another
   *  automatic attempt? */
  classifyError(error: PublishError): PublishRetryClass {
    return retryClassFor(error.code);
  }

  // ---- dispatch (Sprint P2.3-E) --------------------------------------

  /**
   * Is a FAILED job eligible for an AUTOMATIC retry by the dispatcher?
   * Only a RETRYABLE lastError (RATE_LIMITED / TEMPORARY_FAILURE) and fewer
   * than MAX_PUBLISH_ATTEMPTS attempts. VALIDATION / AUTH / PERMANENT and
   * DUPLICATE are never auto-retried (Sprint P2.3-D).
   */
  isEligibleForAutoRetry(job: PublishingJob): boolean {
    return (
      job.status === "FAILED" &&
      job.attemptCount < MAX_PUBLISH_ATTEMPTS &&
      job.lastError?.retryClass === "RETRYABLE"
    );
  }

  /**
   * Run one bounded batch of due jobs (PENDING + auto-retryable FAILED).
   * PRIVILEGED - not user-scoped; the caller (cron dispatch route) is
   * authenticated as the cron secret or an admin, and each job carries its
   * own owner `userId` which runAttempt() uses for the Article read. The
   * batch is capped so one invocation finishes inside the serverless budget.
   *
   * P2.3 builds this execution path; P2.4 wires the actual daily schedule
   * (Vercel Hobby one-cron/day) and any preset-slot semantics.
   */
  async dispatch(opts: { limit?: number } = {}): Promise<DispatchReport> {
    const limit = Math.min(Math.max(opts.limit ?? DEFAULT_DISPATCH_LIMIT, 1), MAX_DISPATCH_LIMIT);
    const jobs = await this.repo.findDispatchableJobs(limit, MAX_PUBLISH_ATTEMPTS);

    const results: DispatchResult[] = [];
    for (const job of jobs) {
      try {
        const { job: after } = await this.runAttempt({ userId: job.userId, jobId: job.id });
        results.push({ jobId: job.id, outcome: after.status === "SUCCEEDED" ? "SUCCEEDED" : "FAILED" });
      } catch (err) {
        results.push({
          jobId: job.id,
          outcome: "ERROR",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { scanned: jobs.length, ran: results.length, results };
  }

  // ---- internals ---------------------------------------------------

  /** Sprint P2.3-B: does a SUCCEEDED job for `destination` move the source
   *  Article to `published` (and thereby make it read-only)? Driven by the
   *  contract's advisory map. Today the only destination (INTERNAL_BLOG) is
   *  website-facing, so this is `true`; a future non-website destination
   *  (e.g. a Slack post) would be excluded here without changing the map. */
  private shouldPublishArticleOnSuccess(destination: PublishingDestinationId): boolean {
    const NON_WEBSITE_DESTINATIONS: readonly PublishingDestinationId[] = [];
    if (NON_WEBSITE_DESTINATIONS.includes(destination)) return false;
    return ARTICLE_STATUS_ON_JOB_SUCCESS.SUCCEEDED === "published";
  }

  /** Best-effort audit - a failed audit write never fails a publish (the
   *  house pattern; cf. services/marketplace/factory/auditTrail.ts writing
   *  outside the mutation transaction). */
  private async auditBestEffort(
    action: "article.published" | "article.publish_failed",
    actorUserId: string,
    articleId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    if (!this.audit) return;
    try {
      await this.audit.record({ actorUserId, action, targetType: "Article", targetId: articleId, metadata });
    } catch {
      // swallowed - observability must not break the operation
    }
  }

  private assertTransition(from: PublishingJobStatus, to: PublishingJobStatus): void {
    if (!isValidJobTransition(from, to)) {
      throw Errors.conflict(`Illegal PublishingJob transition "${from}" -> "${to}"`);
    }
  }

  private normalizeThrown(raw: unknown, destination: PublishingDestinationId): PublishError {
    if (isPublishError(raw)) return raw;
    const message = raw instanceof Error ? raw.message : String(raw);
    return makePublishError("UNKNOWN", `Unexpected adapter failure: ${message}`, { destination });
  }

  /**
   * Sprint P2.3-B: the SUCCEEDED attempt, the SUCCEEDED job, and (for a
   * website-facing destination) the Article -> `published` transition all
   * commit in ONE transaction (repo.commitSuccess). A job can never be
   * SUCCEEDED while its Article is still editable. The `article.published`
   * audit event is written best-effort AFTER the commit.
   */
  private async recordSuccess(
    job: PublishingJob,
    attempt: PublishingAttempt,
    result: PublishResult,
    actorUserId: string,
    meta: Record<string, unknown> | null = null,
  ): Promise<RunAttemptResult> {
    const completedAt = new Date().toISOString();
    const publishArticle = this.shouldPublishArticleOnSuccess(job.destination)
      ? { articleId: job.articleId, actorUserId, jobId: job.id }
      : null;

    const { job: after, attempt: afterAttempt, articlePublished } = await this.repo.commitSuccess({
      jobId: job.id,
      attemptId: attempt.id,
      result,
      completedAt,
      externalReference: result.externalReference ?? null,
      externalUrl: result.externalUrl ?? null,
      destinationResponseMeta: meta,
      publishArticle,
    });

    await this.auditBestEffort("article.published", actorUserId, job.articleId, {
      jobId: job.id,
      destination: job.destination,
      contentHash: job.contentHash,
      externalUrl: result.externalUrl ?? null,
      articleStatusChanged: articlePublished,
    });

    return { job: after, attempt: afterAttempt };
  }

  /** FAILED attempt + FAILED job commit in one transaction. The Article is
   *  NOT touched (a failed publish never changes ArticleStatus - P2.3-B).
   *  `article.publish_failed` is audited best-effort after the commit. */
  private async recordFailure(
    job: PublishingJob,
    attempt: PublishingAttempt,
    error: PublishError,
    actorUserId: string,
  ): Promise<RunAttemptResult> {
    const completedAt = new Date().toISOString();
    const { job: after, attempt: afterAttempt } = await this.repo.commitFailure({
      jobId: job.id,
      attemptId: attempt.id,
      error,
      completedAt,
    });

    await this.auditBestEffort("article.publish_failed", actorUserId, job.articleId, {
      jobId: job.id,
      destination: job.destination,
      errorCode: error.code,
      retryClass: error.retryClass,
      attemptNumber: attempt.attemptNumber,
    });

    return { job: after, attempt: afterAttempt };
  }

  /** Fail a job that never got a real attempt off the ground (the integrity
   *  gate). Records a real terminal attempt so the failure is visible in the
   *  attempt history, then marks the job FAILED. */
  private async failJob(
    job: PublishingJob,
    error: PublishError,
    actorUserId: string,
  ): Promise<RunAttemptResult> {
    this.assertTransition(job.status, "RUNNING");
    const startedAt = new Date().toISOString();
    await this.repo.patchJob(job.id, { status: "RUNNING", startedAt });
    const attemptNumber = await this.repo.incrementAttemptCount(job.id);
    const attempt = await this.repo.appendAttempt({ jobId: job.id, attemptNumber });
    return this.recordFailure(job, attempt, error, actorUserId);
  }
}

export const publishingService = new PublishingService(
  publishingRepository,
  articleService,
  auditLogService,
);

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
import { articleService } from "./article.service";
import type { Article } from "@/types/article";
import { projectArticleToPublishInput } from "./article-serializer";
import { computeContentHash } from "./content-hash";
import { getDestinationAdapter } from "./destinations/registry";
import { publishingRepository, type PublishingRepository } from "./publishing.repository";
import {
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

/** The narrow slice of ArticleService this module needs. `getById(userId, id)`
 *  is the ownership gate - it throws a 404-mapped AppError for an Article the
 *  caller does not own (never leaks another user's row). Injectable so the
 *  service is testable without a database. */
export interface ArticleReader {
  getById(userId: string, id: string): Promise<Article>;
}

export class PublishingService {
  constructor(
    private readonly repo: PublishingRepository = publishingRepository,
    private readonly articles: ArticleReader = articleService,
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
      return this.recordFailure(job.id, attempt, err);
    }

    // publish
    try {
      const result = await adapter.publish(input);
      return this.recordSuccess(job.id, attempt, result);
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
        return this.recordSuccess(job.id, attempt, reconciled, { reconciledFromDuplicate: true });
      }
      return this.recordFailure(job.id, attempt, err);
    }
  }

  /** Public helper for P2.3 dispatch logic: is this error worth another
   *  automatic attempt? */
  classifyError(error: PublishError): PublishRetryClass {
    return retryClassFor(error.code);
  }

  // ---- internals ---------------------------------------------------

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

  private async recordSuccess(
    jobId: string,
    attempt: PublishingAttempt,
    result: PublishResult,
    meta?: Record<string, unknown>,
  ): Promise<RunAttemptResult> {
    const completedAt = new Date().toISOString();
    const patchedAttempt = await this.repo.patchAttempt(attempt.id, {
      status: "SUCCEEDED",
      completedAt,
      externalReference: result.externalReference ?? null,
      externalUrl: result.externalUrl ?? null,
      destinationResponseMeta: meta ?? null,
    });
    const patchedJob = await this.repo.patchJob(jobId, {
      status: "SUCCEEDED",
      completedAt,
      result,
      lastError: null,
    });
    return { job: patchedJob, attempt: patchedAttempt };
  }

  private async recordFailure(
    jobId: string,
    attempt: PublishingAttempt,
    error: PublishError,
  ): Promise<RunAttemptResult> {
    const completedAt = new Date().toISOString();
    const patchedAttempt = await this.repo.patchAttempt(attempt.id, {
      status: "FAILED",
      completedAt,
      error,
    });
    const patchedJob = await this.repo.patchJob(jobId, {
      status: "FAILED",
      completedAt,
      lastError: error,
    });
    return { job: patchedJob, attempt: patchedAttempt };
  }

  /** Fail a job that never got a real attempt off the ground (integrity
   *  gate). Records a synthetic terminal attempt so the failure is visible
   *  in the attempt history, then marks the job FAILED. */
  private async failJob(job: PublishingJob, error: PublishError): Promise<RunAttemptResult> {
    this.assertTransition(job.status, "RUNNING");
    const startedAt = new Date().toISOString();
    await this.repo.patchJob(job.id, { status: "RUNNING", startedAt });
    const attemptNumber = await this.repo.incrementAttemptCount(job.id);
    const attempt = await this.repo.appendAttempt({ jobId: job.id, attemptNumber });
    return this.recordFailure(job.id, attempt, error);
  }
}

export const publishingService = new PublishingService();

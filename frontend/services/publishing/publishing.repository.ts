// services/publishing/publishing.repository.ts
// AT24 Publishing Engine (P2.2) - the ONLY module that reads/writes the
// publishing_jobs / publishing_attempts tables. Server-only.
//
// PublishingAttempt is append-only: this repository exposes `appendAttempt`
// and a narrow `patchAttempt` (RUNNING -> terminal only) - never delete.
// PublishingJob has a narrow `patchJob` for status + lifecycle fields.
//
// Ownership is NOT enforced here - the Publishing Service passes an
// already-authorized userId and this layer scopes queries by it. Adapters
// never reach this module (Sprint P2.1 §16).

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import type {
  PublishingJob,
  PublishingAttempt,
  PublishingJobStatus,
  PublishingAttemptStatus,
  PublishError,
  PublishResult,
  PublicationIdentity,
  PublishingDestinationId,
} from "@/types/publishing";
import {
  isPublishError,
  isPublishResult,
  isPublishingDestinationId,
  isPublishingJobStatus,
  isPublishingAttemptStatus,
} from "@/types/publishing";

const asJson = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;

// ---- row -> contract mappers --------------------------------------------

type JobRow = {
  id: string;
  articleId: string;
  userId: string;
  destination: string;
  status: string;
  contentHash: string;
  idempotencyKey: string;
  scheduledFor: Date | null;
  requestedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  attemptCount: number;
  lastError: unknown;
  result: unknown;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

type AttemptRow = {
  id: string;
  jobId: string;
  attemptNumber: number;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  error: unknown;
  externalReference: string | null;
  externalUrl: string | null;
  destinationResponseMeta: unknown;
  createdAt: Date;
};

function toJob(row: JobRow): PublishingJob {
  return {
    id: row.id,
    articleId: row.articleId,
    userId: row.userId,
    destination: (isPublishingDestinationId(row.destination)
      ? row.destination
      : row.destination) as PublishingDestinationId,
    status: (isPublishingJobStatus(row.status) ? row.status : "PENDING") as PublishingJobStatus,
    contentHash: row.contentHash,
    idempotencyKey: row.idempotencyKey,
    scheduledFor: row.scheduledFor ? row.scheduledFor.toISOString() : null,
    requestedAt: row.requestedAt.toISOString(),
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    attemptCount: row.attemptCount,
    lastError: isPublishError(row.lastError) ? (row.lastError as PublishError) : null,
    result: isPublishResult(row.result) ? (row.result as PublishResult) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toAttempt(row: AttemptRow): PublishingAttempt {
  return {
    id: row.id,
    jobId: row.jobId,
    attemptNumber: row.attemptNumber,
    status: (isPublishingAttemptStatus(row.status) ? row.status : "RUNNING") as PublishingAttemptStatus,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    error: isPublishError(row.error) ? (row.error as PublishError) : null,
    externalReference: row.externalReference,
    externalUrl: row.externalUrl,
    destinationResponseMeta:
      row.destinationResponseMeta && typeof row.destinationResponseMeta === "object"
        ? (row.destinationResponseMeta as Record<string, unknown>)
        : null,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---- inputs -------------------------------------------------------------

export interface CreateJobInput {
  articleId: string;
  userId: string;
  destination: PublishingDestinationId;
  contentHash: string;
  idempotencyKey: string;
  scheduledFor?: string | null;
}

export interface PatchJobInput {
  status?: PublishingJobStatus;
  startedAt?: string | null;
  completedAt?: string | null;
  attemptCount?: number;
  lastError?: PublishError | null;
  result?: PublishResult | null;
}

export interface AppendAttemptInput {
  jobId: string;
  attemptNumber: number;
}

export interface PatchAttemptInput {
  status: PublishingAttemptStatus;
  completedAt: string;
  error?: PublishError | null;
  externalReference?: string | null;
  externalUrl?: string | null;
  destinationResponseMeta?: Record<string, unknown> | null;
}

// ---- repository -------------------------------------------------------

export class PublishingRepository {
  /** Idempotency lookup - the P2.1 publication identity
   *  (articleId, destination, contentHash), backed by the @@unique index. */
  async findJobByIdentity(identity: PublicationIdentity): Promise<PublishingJob | null> {
    const row = (await prisma.publishingJob.findFirst({
      where: {
        articleId: identity.articleId,
        destination: identity.destination,
        contentHash: identity.contentHash,
        deletedAt: null,
      },
    })) as JobRow | null;
    return row ? toJob(row) : null;
  }

  /** Ownership-scoped read. Returns null if the job is not the user's. */
  async findJobForUser(id: string, userId: string): Promise<PublishingJob | null> {
    const row = (await prisma.publishingJob.findFirst({
      where: { id, userId, deletedAt: null },
    })) as JobRow | null;
    return row ? toJob(row) : null;
  }

  async listJobsForArticle(articleId: string, userId: string): Promise<PublishingJob[]> {
    const rows = (await prisma.publishingJob.findMany({
      where: { articleId, userId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    })) as JobRow[];
    return rows.map(toJob);
  }

  async createJob(input: CreateJobInput): Promise<PublishingJob> {
    const row = (await prisma.publishingJob.create({
      data: {
        articleId: input.articleId,
        userId: input.userId,
        destination: input.destination,
        contentHash: input.contentHash,
        idempotencyKey: input.idempotencyKey,
        scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
        status: "PENDING",
      },
    })) as JobRow;
    return toJob(row);
  }

  async patchJob(id: string, patch: PatchJobInput): Promise<PublishingJob> {
    const data: Prisma.PublishingJobUpdateInput = {};
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.startedAt !== undefined) data.startedAt = patch.startedAt ? new Date(patch.startedAt) : null;
    if (patch.completedAt !== undefined) {
      data.completedAt = patch.completedAt ? new Date(patch.completedAt) : null;
    }
    if (patch.attemptCount !== undefined) data.attemptCount = patch.attemptCount;
    if (patch.lastError !== undefined) {
      data.lastError = patch.lastError === null ? Prisma.DbNull : asJson(patch.lastError);
    }
    if (patch.result !== undefined) {
      data.result = patch.result === null ? Prisma.DbNull : asJson(patch.result);
    }
    const row = (await prisma.publishingJob.update({ where: { id }, data })) as JobRow;
    return toJob(row);
  }

  /** Atomically increment attemptCount - used when a new attempt starts so
   *  two dispatchers cannot both think they are attempt N. */
  async incrementAttemptCount(id: string): Promise<number> {
    const row = (await prisma.publishingJob.update({
      where: { id },
      data: { attemptCount: { increment: 1 } },
      select: { attemptCount: true },
    })) as { attemptCount: number };
    return row.attemptCount;
  }

  async appendAttempt(input: AppendAttemptInput): Promise<PublishingAttempt> {
    const row = (await prisma.publishingAttempt.create({
      data: {
        jobId: input.jobId,
        attemptNumber: input.attemptNumber,
        status: "RUNNING",
      },
    })) as AttemptRow;
    return toAttempt(row);
  }

  async patchAttempt(id: string, patch: PatchAttemptInput): Promise<PublishingAttempt> {
    const row = (await prisma.publishingAttempt.update({
      where: { id },
      data: {
        status: patch.status,
        completedAt: new Date(patch.completedAt),
        error: patch.error === undefined || patch.error === null ? Prisma.DbNull : asJson(patch.error),
        externalReference: patch.externalReference ?? null,
        externalUrl: patch.externalUrl ?? null,
        destinationResponseMeta:
          patch.destinationResponseMeta === undefined || patch.destinationResponseMeta === null
            ? Prisma.DbNull
            : asJson(patch.destinationResponseMeta),
      },
    })) as AttemptRow;
    return toAttempt(row);
  }

  async listAttempts(jobId: string): Promise<PublishingAttempt[]> {
    const rows = (await prisma.publishingAttempt.findMany({
      where: { jobId },
      orderBy: { attemptNumber: "asc" },
    })) as AttemptRow[];
    return rows.map(toAttempt);
  }
}

export const publishingRepository = new PublishingRepository();

// services/ai/publishing/publisher.service.ts
import type { PublishingJob, PublishChannel } from "@/types/publishing-job";
import type { FeatureMeta } from "@/types/feature-meta";

export const publisherMeta: FeatureMeta = {
  featureId: "publisher",
  requiredPlan: "premium",
  estimatedCost: 2,
  dailyUsageWeight: 2,
};

export const SUPPORTED_CHANNELS: PublishChannel[] = [
  "website", "blog", "rss", "newsletter", "telegram", "twitter", "linkedin",
];

export function createPublishingJob(articleId: string, channels: PublishChannel[], scheduledFor: string): PublishingJob {
  return {
    id: `job-${Date.now()}`,
    articleId,
    channels,
    status: "queued",
    scheduledFor,
    createdAt: new Date().toISOString(),
  };
}

// Placeholder — future: cron/worker/queue dispatches to real channel adapters.
export async function runJob(job: PublishingJob): Promise<PublishingJob> {
  return { ...job, status: "done" };
}
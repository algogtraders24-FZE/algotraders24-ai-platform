// types/publishing-job.ts
export type PublishChannel =
  | "website"
  | "blog"
  | "rss"
  | "newsletter"
  | "telegram"
  | "twitter"
  | "linkedin";

export type JobStatus = "queued" | "running" | "done" | "failed";

export interface PublishingJob {
  id: string;
  articleId: string;
  channels: PublishChannel[];
  status: JobStatus;
  scheduledFor: string;
  createdAt: string;
}
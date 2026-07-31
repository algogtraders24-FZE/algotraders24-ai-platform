// components/publishing/PublishingStatus.tsx
import type { ArticleStatus } from "@/types/article";

const MAP: Record<ArticleStatus, string> = {
  draft: "bg-ink-4 text-text-2 border-border",
  scheduled: "bg-warning/15 text-warning border-warning/30",
  published: "bg-success/15 text-success border-success/30",
  failed: "bg-danger/15 text-danger border-danger/30",
};

export default function PublishingStatus({ status }: { status: ArticleStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${MAP[status]}`}>
      {status}
    </span>
  );
}
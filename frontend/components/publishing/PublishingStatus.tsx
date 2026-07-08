// components/publishing/PublishingStatus.tsx
import type { ArticleStatus } from "@/types/article";

const MAP: Record<ArticleStatus, string> = {
  draft: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  scheduled: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  published: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  failed: "bg-red-500/15 text-red-400 border-red-500/30",
};

export default function PublishingStatus({ status }: { status: ArticleStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${MAP[status]}`}>
      {status}
    </span>
  );
}
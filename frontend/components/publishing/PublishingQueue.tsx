// components/publishing/PublishingQueue.tsx
import type { Article } from "@/types/article";
import PublishingStatus from "./PublishingStatus";

export default function PublishingQueue({ articles }: { articles: Article[] }) {
  const queued = articles.filter((a) => a.status === "scheduled" || a.status === "draft");
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-ink-2 text-left text-xs uppercase text-text-3">
          <tr>
            <th className="px-4 py-3">Article</th>
            <th className="px-4 py-3">Category</th>
            <th className="px-4 py-3">Scheduled</th>
            <th className="px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {queued.map((a) => (
            <tr key={a.id} className="hover:bg-ink-2">
              <td className="px-4 py-3 font-medium text-text">{a.title}</td>
              <td className="px-4 py-3 capitalize text-text-2">{a.category.replace(/-/g, " ")}</td>
              <td className="px-4 py-3 text-text-2">{a.scheduledFor ? new Date(a.scheduledFor).toLocaleString() : "—"}</td>
              <td className="px-4 py-3"><PublishingStatus status={a.status} /></td>
            </tr>
          ))}
          {queued.length === 0 && (
            <tr><td colSpan={4} className="px-4 py-6 text-center text-xs text-text-3">Queue is empty.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
// components/publishing/PublishingQueue.tsx
import type { Article } from "@/types/article";
import PublishingStatus from "./PublishingStatus";

export default function PublishingQueue({ articles }: { articles: Article[] }) {
  const queued = articles.filter((a) => a.status === "scheduled" || a.status === "draft");
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className="w-full text-sm">
        <thead className="bg-slate-900/60 text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-3">Article</th>
            <th className="px-4 py-3">Category</th>
            <th className="px-4 py-3">Scheduled</th>
            <th className="px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {queued.map((a) => (
            <tr key={a.id} className="hover:bg-slate-900/40">
              <td className="px-4 py-3 font-medium text-slate-100">{a.title}</td>
              <td className="px-4 py-3 capitalize text-slate-400">{a.category.replace(/-/g, " ")}</td>
              <td className="px-4 py-3 text-slate-400">{a.scheduledFor ? new Date(a.scheduledFor).toLocaleString() : "—"}</td>
              <td className="px-4 py-3"><PublishingStatus status={a.status} /></td>
            </tr>
          ))}
          {queued.length === 0 && (
            <tr><td colSpan={4} className="px-4 py-6 text-center text-xs text-slate-600">Queue is empty.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
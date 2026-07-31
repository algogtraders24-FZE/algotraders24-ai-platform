// components/knowledge/KnowledgeHistory.tsx
import type { RetrievalRecord } from "@/types/knowledge";

export default function KnowledgeHistory({ records }: { records: RetrievalRecord[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-ink-2 text-left text-xs uppercase text-text-3">
          <tr>
            <th className="px-4 py-3">Query</th>
            <th className="px-4 py-3">Document</th>
            <th className="px-4 py-3">Score</th>
            <th className="px-4 py-3">When</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {records.slice(0, 10).map((r) => (
            <tr key={r.id} className="hover:bg-ink-2">
              <td className="px-4 py-3 text-text">{r.query}</td>
              <td className="px-4 py-3 text-text-2">{r.documentTitle}</td>
              <td className="px-4 py-3 font-semibold text-gold">{r.score}%</td>
              <td className="px-4 py-3 text-text-3">{new Date(r.retrievedAt).toLocaleTimeString()}</td>
            </tr>
          ))}
          {records.length === 0 && (
            <tr><td colSpan={4} className="px-4 py-6 text-center text-xs text-text-3">No retrievals yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
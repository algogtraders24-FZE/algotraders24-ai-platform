// components/knowledge/KnowledgeHistory.tsx
import type { RetrievalRecord } from "@/types/knowledge";

export default function KnowledgeHistory({ records }: { records: RetrievalRecord[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className="w-full text-sm">
        <thead className="bg-slate-900/60 text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-3">Query</th>
            <th className="px-4 py-3">Document</th>
            <th className="px-4 py-3">Score</th>
            <th className="px-4 py-3">When</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {records.slice(0, 10).map((r) => (
            <tr key={r.id} className="hover:bg-slate-900/40">
              <td className="px-4 py-3 text-slate-200">{r.query}</td>
              <td className="px-4 py-3 text-slate-400">{r.documentTitle}</td>
              <td className="px-4 py-3 font-semibold text-indigo-400">{r.score}%</td>
              <td className="px-4 py-3 text-slate-500">{new Date(r.retrievedAt).toLocaleTimeString()}</td>
            </tr>
          ))}
          {records.length === 0 && (
            <tr><td colSpan={4} className="px-4 py-6 text-center text-xs text-slate-600">No retrievals yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
// components/knowledge/KnowledgeMetrics.tsx
import type { KnowledgeMetrics as Metrics } from "@/types/knowledge";

export default function KnowledgeMetrics({ metrics }: { metrics: Metrics }) {
  const cards: [string, string | number][] = [
    ["Total Documents", metrics.totalDocuments],
    ["Categories", metrics.categories],
    ["Collections", metrics.collections],
    ["Indexed", metrics.indexedDocuments],
    ["Searches Today", metrics.searchesToday],
    ["Health", `${metrics.knowledgeHealth}%`],
    ["Avg Retrieval", `${metrics.avgRetrievalMs}ms`],
    ["AI References", metrics.aiReferences],
  ];
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {cards.map(([label, value]) => (
        <div key={label} className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <p className="text-xs text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-bold text-slate-100">{value}</p>
        </div>
      ))}
    </div>
  );
}
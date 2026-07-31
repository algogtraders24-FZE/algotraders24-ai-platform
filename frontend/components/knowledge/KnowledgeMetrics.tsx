// components/knowledge/KnowledgeMetrics.tsx
// Sprint D1.0 - Retrofitted onto Card + tokens (slate-800/900 -> ink-2/
// border, slate-100/500 -> text/text-3).
import type { KnowledgeMetrics as Metrics } from "@/types/knowledge";
import Card from "@/components/ui/Card";

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
        <Card key={label} padding="sm">
          <p className="text-xs text-text-3">{label}</p>
          <p className="mt-1 text-2xl font-bold text-text">{value}</p>
        </Card>
      ))}
    </div>
  );
}

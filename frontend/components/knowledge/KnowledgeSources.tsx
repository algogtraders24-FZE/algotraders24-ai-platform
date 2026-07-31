// components/knowledge/KnowledgeSources.tsx
// Sprint L2.2 - "SEO Articles" removed: it was listed as an active
// ingestion source but no such automated pipeline exists anywhere in this
// codebase (SEO Articles is only ever a category *label* a user can pick
// for a manually-uploaded document - a real but unrelated fact, not
// evidence of a real source). "Vector Database" flipped from "planned" to
// "active": pgvector storage is now genuinely wired (services/knowledge/
// IngestionService.ts -> RepositoryFactory.vectors()).
const SOURCES = [
  { name: "Manual Upload", status: "active" },
  { name: "Vector Database", status: "active" },
  { name: "Web Crawler", status: "planned" },
  { name: "Google Drive", status: "planned" },
  { name: "Notion", status: "planned" },
];

export default function KnowledgeSources() {
  return (
    <div className="rounded-xl border border-border bg-ink-2 p-4">
      <p className="mb-3 text-sm font-semibold text-text-2">Knowledge Sources</p>
      <div className="grid grid-cols-2 gap-2">
        {SOURCES.map((s) => (
          <div key={s.name} className="flex items-center justify-between rounded-lg bg-ink px-3 py-2 text-xs">
            <span className="text-text-2">{s.name}</span>
            <span className={s.status === "active" ? "text-success" : "text-text-3"}>{s.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
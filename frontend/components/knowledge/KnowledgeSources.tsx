// components/knowledge/KnowledgeSources.tsx
const SOURCES = [
  { name: "Manual Upload", status: "active" },
  { name: "SEO Articles", status: "active" },
  { name: "Vector Database", status: "planned" },
  { name: "Web Crawler", status: "planned" },
  { name: "Google Drive", status: "planned" },
  { name: "Notion", status: "planned" },
];

export default function KnowledgeSources() {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <p className="mb-3 text-sm font-semibold text-slate-300">Knowledge Sources</p>
      <div className="grid grid-cols-2 gap-2">
        {SOURCES.map((s) => (
          <div key={s.name} className="flex items-center justify-between rounded-lg bg-slate-950/40 px-3 py-2 text-xs">
            <span className="text-slate-300">{s.name}</span>
            <span className={s.status === "active" ? "text-emerald-400" : "text-slate-600"}>{s.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
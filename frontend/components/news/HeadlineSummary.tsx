// components/news/HeadlineSummary.tsx
export default function HeadlineSummary({ summary }: { summary: string }) {
  return (
    <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-4">
      <p className="text-xs font-semibold uppercase text-indigo-400">AI Market Impact</p>
      <p className="mt-1 text-sm text-slate-200">{summary}</p>
    </div>
  );
}
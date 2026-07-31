// components/news/HeadlineSummary.tsx
export default function HeadlineSummary({ summary }: { summary: string }) {
  return (
    <div className="rounded-xl border border-gold/30 bg-gold/10 p-4">
      <p className="text-xs font-semibold uppercase text-gold">AI Market Impact</p>
      <p className="mt-1 text-sm text-text">{summary}</p>
    </div>
  );
}
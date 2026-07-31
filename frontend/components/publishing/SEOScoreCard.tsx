// components/publishing/SEOScoreCard.tsx
export default function SEOScoreCard({ score }: { score: number }) {
  const color = score >= 80 ? "bg-success" : score >= 70 ? "bg-warning" : "bg-danger";
  const label = score >= 80 ? "Strong" : score >= 70 ? "Good" : "Needs work";
  return (
    <div className="rounded-xl border border-border bg-ink-2 p-4">
      <p className="text-xs text-text-3">SEO Score</p>
      <p className="mt-1 text-2xl font-bold text-text">{score}</p>
      <div className="mt-3 h-2 w-full rounded-full bg-ink-3">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <p className="mt-1 text-xs text-text-3">{label}</p>
    </div>
  );
}
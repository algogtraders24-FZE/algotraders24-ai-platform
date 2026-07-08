// components/publishing/SEOScoreCard.tsx
export default function SEOScoreCard({ score }: { score: number }) {
  const color = score >= 80 ? "bg-emerald-500" : score >= 70 ? "bg-amber-500" : "bg-red-500";
  const label = score >= 80 ? "Strong" : score >= 70 ? "Good" : "Needs work";
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <p className="text-xs text-slate-500">SEO Score</p>
      <p className="mt-1 text-2xl font-bold text-slate-100">{score}</p>
      <div className="mt-3 h-2 w-full rounded-full bg-slate-800">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <p className="mt-1 text-xs text-slate-500">{label}</p>
    </div>
  );
}
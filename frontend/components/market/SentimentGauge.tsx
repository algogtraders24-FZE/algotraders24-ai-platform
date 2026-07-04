// components/market/SentimentGauge.tsx
import type { SentimentLabel } from "@/types/sentiment";

const MAP: Record<SentimentLabel, string> = {
  bullish: "text-emerald-400",
  bearish: "text-red-400",
  neutral: "text-slate-400",
};

// score: -100 to 100 → 0 to 100 for the bar
export default function SentimentGauge({ label, score }: { label: SentimentLabel; score: number }) {
  const pct = Math.round((score + 100) / 2);
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <p className="text-xs text-slate-500">Sentiment</p>
      <p className={`mt-1 text-lg font-bold capitalize ${MAP[label]}`}>{label}</p>
      <div className="mt-3 h-1.5 w-full rounded-full bg-slate-800">
        <div className="h-1.5 rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-slate-500">Score {score}</p>
    </div>
  );
}
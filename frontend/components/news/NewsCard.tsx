// components/news/NewsCard.tsx
import type { NewsArticle } from "@/types/news";
import ImpactBadge from "./ImpactBadge";

const DIR: Record<NewsArticle["impact"]["direction"], string> = {
  bullish: "text-emerald-400",
  bearish: "text-red-400",
  neutral: "text-slate-400",
};

export default function NewsCard({ article }: { article: NewsArticle }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 transition hover:border-slate-700">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-100">{article.headline}</h3>
        <ImpactBadge level={article.impact.level} />
      </div>
      <p className="mt-2 text-xs text-slate-400">{article.summary}</p>
      <div className="mt-3 rounded-lg bg-slate-950/50 p-2">
        <p className="text-xs text-indigo-300">AI: {article.aiSummary}</p>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs">
        <span className="capitalize text-slate-500">{article.category} · {article.source}</span>
        <span className={`font-semibold capitalize ${DIR[article.impact.direction]}`}>{article.impact.direction}</span>
      </div>
    </div>
  );
}
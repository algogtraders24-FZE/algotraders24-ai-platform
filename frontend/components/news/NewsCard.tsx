// components/news/NewsCard.tsx
import type { NewsArticle } from "@/types/news";
import ImpactBadge from "./ImpactBadge";

const DIR: Record<NewsArticle["impact"]["direction"], string> = {
  bullish: "text-success",
  bearish: "text-danger",
  neutral: "text-text-2",
};

export default function NewsCard({ article }: { article: NewsArticle }) {
  return (
    <div className="rounded-xl border border-border bg-ink-2 p-4 transition hover:border-border">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-text">{article.headline}</h3>
        <ImpactBadge level={article.impact.level} />
      </div>
      <p className="mt-2 text-xs text-text-2">{article.summary}</p>
      <div className="mt-3 rounded-lg bg-ink p-2">
        <p className="text-xs text-gold">AI: {article.aiSummary}</p>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs">
        <span className="capitalize text-text-3">{article.category} · {article.source}</span>
        <span className={`font-semibold capitalize ${DIR[article.impact.direction]}`}>{article.impact.direction}</span>
      </div>
    </div>
  );
}
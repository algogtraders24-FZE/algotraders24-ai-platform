// components/publishing/ArticleCard.tsx
import type { Article } from "@/types/article";
import PublishingStatus from "./PublishingStatus";

interface Props {
  article: Article;
  onOpen: (id: string) => void;
}

export default function ArticleCard({ article, onOpen }: Props) {
  return (
    <button
      onClick={() => onOpen(article.id)}
      className="w-full rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-left transition hover:border-slate-700"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-100">{article.title}</h3>
        <PublishingStatus status={article.status} />
      </div>
      <p className="mt-2 text-xs text-slate-400 line-clamp-2">{article.summary}</p>
      <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
        <span className="capitalize">{article.category.replace(/-/g, " ")}</span>
        <span>SEO {article.seo.score}</span>
      </div>
    </button>
  );
}
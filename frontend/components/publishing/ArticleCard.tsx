// components/publishing/ArticleCard.tsx
// Sprint UI-03 - rounded-xl -> rounded-card (the design-system token, same
// 12px value but named, not coincidental). Stays a hand-rolled <button>
// rather than composing Card - the whole element IS the click target, same
// as licenses/page.tsx's card-shaped <Link> - Card has no "as button" mode.
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
      className="w-full rounded-card border border-border bg-ink-2 p-4 text-left transition hover:border-gold/40"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-text">{article.title}</h3>
        <PublishingStatus status={article.status} />
      </div>
      <p className="mt-2 text-xs text-text-2 line-clamp-2">{article.summary}</p>
      <div className="mt-3 flex items-center justify-between text-xs text-text-3">
        <span className="capitalize">{article.category.replace(/-/g, " ")}</span>
        <span>SEO {article.seo.score}</span>
      </div>
    </button>
  );
}
// components/publishing/ArticlePreview.tsx
import type { Article } from "@/types/article";
import PublishingStatus from "./PublishingStatus";

interface Props {
  article: Article | null;
  aiDraft?: string | null;
}

export default function ArticlePreview({ article, aiDraft }: Props) {
  if (!article) {
    return (
      <div className="rounded-xl border border-border bg-ink-2 p-6 text-sm text-text-3">
        Select an article to preview.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-ink-2 p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-bold text-text">{article.title}</h2>
        <PublishingStatus status={article.status} />
      </div>
      <p className="mt-1 text-xs text-text-3">/{article.seo.slug}</p>
      <p className="mt-3 text-sm text-text-2">{article.summary}</p>

      <div className="mt-4 space-y-3">
        {article.sections.map((s, i) => (
          <div key={i}>
            <h3 className="text-sm font-semibold text-text">{s.heading}</h3>
            <p className="mt-1 text-sm text-text-2">{s.body}</p>
          </div>
        ))}
      </div>

      {aiDraft && (
        <div className="mt-4 rounded-lg bg-ink p-3">
          <p className="text-xs font-semibold text-gold">Gemini Draft</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-text-2">{aiDraft}</p>
        </div>
      )}

      <p className="mt-4 border-t border-border pt-3 text-xs text-text-3">{article.disclaimer}</p>
    </div>
  );
}
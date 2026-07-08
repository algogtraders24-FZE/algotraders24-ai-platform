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
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-sm text-slate-500">
        Select an article to preview.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-100">{article.title}</h2>
        <PublishingStatus status={article.status} />
      </div>
      <p className="mt-1 text-xs text-slate-500">/{article.seo.slug}</p>
      <p className="mt-3 text-sm text-slate-400">{article.summary}</p>

      <div className="mt-4 space-y-3">
        {article.sections.map((s, i) => (
          <div key={i}>
            <h3 className="text-sm font-semibold text-slate-200">{s.heading}</h3>
            <p className="mt-1 text-sm text-slate-400">{s.body}</p>
          </div>
        ))}
      </div>

      {aiDraft && (
        <div className="mt-4 rounded-lg bg-slate-950/50 p-3">
          <p className="text-xs font-semibold text-indigo-400">Gemini Draft</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-300">{aiDraft}</p>
        </div>
      )}

      <p className="mt-4 border-t border-slate-800 pt-3 text-xs text-slate-600">{article.disclaimer}</p>
    </div>
  );
}
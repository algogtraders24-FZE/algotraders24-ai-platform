// components/news/NewsCard.tsx
// AN1.7 - rebuilt for the real NewsArticleDTO (app/api/private/intelligence/
// news/route.ts) - the old version rendered the mock NewsArticle shape
// (fake impact/aiSummary fields with no real equivalent). Sentiment is
// shown exactly as the provider returned it (e.g. "Somewhat-Bullish",
// hyphenated) - never relabeled. Provenance is disclosed via each asset
// tag's title tooltip rather than always-visible text, per "where useful."
import Badge, { type BadgeTone } from "@/components/ui/Badge";

export interface NewsArticleDTO {
  id: string;
  headline: string;
  summary: string | null;
  url: string | null;
  sourceName: string | null;
  provider: string;
  publishedAt: string | null;
  fetchedAt: string;
  sentimentScore: number | null;
  sentimentLabel: string | null;
  category: string | null;
  assetTags: string[];
  tagProvenance: Record<string, { method: string; confidence: number }> | null;
}

function sentimentTone(label: string | null): BadgeTone {
  if (!label) return "neutral";
  if (label.includes("Bullish")) return "success";
  if (label.includes("Bearish")) return "danger";
  return "neutral";
}

function provenanceLabel(method: string): string {
  switch (method) {
    case "native_ticker":
      return "matched directly by the news provider";
    case "topic_derived":
      return "inferred from the article's general topic";
    case "keyword_inferred":
      return "inferred from a keyword match in the headline/summary";
    default:
      return method;
  }
}

export default function NewsCard({ article }: { article: NewsArticleDTO }) {
  const provenance = article.tagProvenance ?? {};
  return (
    <div className="rounded-xl border border-border bg-ink-2 p-4 transition hover:border-gold/40">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-text">{article.headline}</h3>
        {article.sentimentLabel && <Badge tone={sentimentTone(article.sentimentLabel)}>{article.sentimentLabel}</Badge>}
      </div>

      {article.summary && <p className="mt-2 text-xs text-text-2">{article.summary}</p>}

      {article.assetTags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {article.assetTags.map((tag) => {
            const meta = provenance[tag];
            return (
              <span
                key={tag}
                title={meta ? `Tagged ${tag}: ${provenanceLabel(meta.method)}` : tag}
                className="rounded-control border border-border px-2 py-0.5 text-[10px] font-medium text-text-3"
              >
                {tag}
              </span>
            );
          })}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between text-xs">
        <span className="text-text-3">
          {article.category ?? "Uncategorized"} &middot; {article.sourceName ?? "Newswire"}
        </span>
        {article.url && (
          <a href={article.url} target="_blank" rel="noopener noreferrer" className="font-medium text-gold hover:underline">
            Read more &rarr;
          </a>
        )}
      </div>
    </div>
  );
}

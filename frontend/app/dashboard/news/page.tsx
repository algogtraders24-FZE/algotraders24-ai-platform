// app/dashboard/news/page.tsx
// AN1.7 - real news, real API, no static/mock dependency. Per the locked
// AN1.7 decision: the old "High Impact Economic Events" section is REMOVED
// entirely (not rendered mock, not disclosed as preview) - AN1 only ever
// researched and built a real NEWS pipeline; economic-calendar data needs
// its own future provider/contract/audit rather than sitting mock next to
// now-real news, which would be more misleading than the honest "· mock
// data" label this page used to carry (data provenance consistency).
"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import Alert from "@/components/ui/Alert";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import NewsCard, { type NewsArticleDTO } from "@/components/news/NewsCard";
import { NEWS_CATEGORIES, type NewsCategory } from "@/types/news-category";

// AT24's enabled market universe (lib/market-data/market-registry.ts) -
// duplicated here as plain strings rather than importing the server
// registry into a client component; if that list grows, this filter row
// grows with it in a follow-up, not silently drifting since both are small
// and human-reviewed.
const FILTER_SYMBOLS = ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "XAGUSD", "BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD"] as const;

const PAGE_SIZE = 20;

interface NewsResponse {
  items: NewsArticleDTO[];
  total: number;
  page: number;
  pageSize: number;
  freshness: { latestFetchedAt: string | null; isStale: boolean };
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 1) return "less than an hour ago";
  if (hours === 1) return "1 hour ago";
  if (hours < 48) return `${hours} hours ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: NewsArticleDTO[]; total: number; freshness: NewsResponse["freshness"] };

export default function NewsPage() {
  const [symbol, setSymbol] = useState<string | null>(null);
  const [category, setCategory] = useState<NewsCategory | null>(null);
  const [page, setPage] = useState(1);
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const fetchNews = useCallback(
    async (targetPage: number, append: boolean) => {
      if (!append) setState({ status: "loading" });
      const params = new URLSearchParams({ page: String(targetPage), pageSize: String(PAGE_SIZE) });
      if (symbol) params.set("symbol", symbol);
      if (category) params.set("category", category);

      try {
        const res = await fetch(`/api/private/intelligence/news?${params.toString()}`);
        const json = (await res.json().catch(() => null)) as { status?: string; data?: NewsResponse; error?: { message?: string } } | null;
        if (!res.ok || !json || json.status !== "ok" || !json.data) {
          setState({ status: "error", message: json?.error?.message || "Could not load news." });
          return;
        }
        const data = json.data;
        setState((prev) => ({
          status: "ready",
          items: append && prev.status === "ready" ? [...prev.items, ...data.items] : data.items,
          total: data.total,
          freshness: data.freshness,
        }));
      } catch {
        setState({ status: "error", message: "Network error - could not reach the news service." });
      }
    },
    [symbol, category],
  );

  useEffect(() => {
    setPage(1);
    void fetchNews(1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, category]);

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    void fetchNews(next, true);
  };

  return (
    <div className="min-h-screen bg-ink p-6 text-text">
      <div className="mx-auto max-w-6xl">
        <PageHeader eyebrow="AI News" title="AI Financial News" description="Real headlines, sentiment, and asset relevance from Alpha Vantage." />

        {state.status === "ready" && (
          <Alert tone={state.freshness.isStale ? "warning" : "info"} title={state.freshness.isStale ? "News may be out of date" : "Updated"} className="mb-6">
            {state.freshness.latestFetchedAt
              ? `Last successful update ${timeAgo(state.freshness.latestFetchedAt)}${state.freshness.isStale ? " - may not reflect the latest news." : "."}`
              : "No successful update yet."}
          </Alert>
        )}

        <div className="mb-4 flex flex-wrap gap-2">
          <button
            onClick={() => setSymbol(null)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${symbol === null ? "border-gold/40 bg-gold/15 text-gold" : "border-border text-text-2 hover:border-border"}`}
          >
            All symbols
          </button>
          {FILTER_SYMBOLS.map((s) => (
            <button
              key={s}
              onClick={() => setSymbol(s)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${symbol === s ? "border-gold/40 bg-gold/15 text-gold" : "border-border text-text-2 hover:border-border"}`}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="mb-6 flex flex-wrap gap-2">
          <button
            onClick={() => setCategory(null)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition ${category === null ? "border-gold/40 bg-gold/15 text-gold" : "border-border text-text-2 hover:border-border"}`}
          >
            All categories
          </button>
          {NEWS_CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition ${category === c ? "border-gold/40 bg-gold/15 text-gold" : "border-border text-text-2 hover:border-border"}`}
            >
              {c}
            </button>
          ))}
        </div>

        {state.status === "loading" && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-40 animate-pulse rounded-xl border border-border bg-ink-2" />
            ))}
          </div>
        )}

        {state.status === "error" && (
          <div className="rounded-card border border-danger/30 bg-danger/10 p-6">
            <p className="text-sm font-semibold text-danger">Could not load news</p>
            <p className="mt-1 text-sm text-text-2">{state.message}</p>
            <Button variant="secondary" className="mt-4" onClick={() => fetchNews(1, false)}>
              Retry
            </Button>
          </div>
        )}

        {state.status === "ready" && state.items.length === 0 && (
          <EmptyState title="No news matches the current filters." description="Try a different symbol or category above." />
        )}

        {state.status === "ready" && state.items.length > 0 && (
          <>
            <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {state.items.map((article) => (
                <NewsCard key={article.id} article={article} />
              ))}
            </section>
            {state.items.length < state.total && (
              <div className="mt-6 flex justify-center">
                <Button variant="secondary" onClick={loadMore}>
                  Load more
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

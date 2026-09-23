// app/dashboard/news/page.tsx
// AN1.7 - real news, real API, no static/mock dependency. Per the locked
// AN1.7 decision: the old "High Impact Economic Events" section is REMOVED
// entirely (not rendered mock, not disclosed as preview) - AN1 only ever
// researched and built a real NEWS pipeline; economic-calendar data needs
// its own future provider/contract/audit rather than sitting mock next to
// now-real news, which would be more misleading than the honest "· mock
// data" label this page used to carry (data provenance consistency).
"use client";

// Sprint UI-02.7 - cross-dashboard consistency: self min-h-screen/max-w-6xl
// wrapper removed (AppShell already provides it), symbol/category filter
// chips -> Button (variant swap for the active/inactive state, same
// technique established for every other segmented toggle in this program),
// hand-rolled loading pulse divs -> Skeleton. Same fetch/filter/pagination
// logic throughout.
import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import Alert from "@/components/ui/Alert";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import Button from "@/components/ui/Button";
import Skeleton from "@/components/ui/Skeleton";
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
    <div>
      <PageHeader eyebrow="AI News" title="AI Financial News" description="Real financial headlines with sentiment and asset relevance for the instruments you trade." />

      {state.status === "ready" && (
        <Alert tone={state.freshness.isStale ? "warning" : "info"} title={state.freshness.isStale ? "News may be out of date" : "Updated"} className="mb-6">
          {state.freshness.latestFetchedAt
            ? `Last successful update ${timeAgo(state.freshness.latestFetchedAt)}${state.freshness.isStale ? " - may not reflect the latest news." : "."}`
            : "No successful update yet."}
        </Alert>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <Button size="sm" variant={symbol === null ? "primary" : "secondary"} onClick={() => setSymbol(null)}>
          All symbols
        </Button>
        {FILTER_SYMBOLS.map((s) => (
          <Button key={s} size="sm" variant={symbol === s ? "primary" : "secondary"} onClick={() => setSymbol(s)}>
            {s}
          </Button>
        ))}
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <Button size="sm" variant={category === null ? "primary" : "secondary"} className="capitalize" onClick={() => setCategory(null)}>
          All categories
        </Button>
        {NEWS_CATEGORIES.map((c) => (
          <Button key={c} size="sm" variant={category === c ? "primary" : "secondary"} className="capitalize" onClick={() => setCategory(c)}>
            {c}
          </Button>
        ))}
      </div>

      {state.status === "loading" && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      )}

      {state.status === "error" && (
        <ErrorState
          title="Could not load news"
          description={state.message}
          action={
            <Button variant="secondary" onClick={() => fetchNews(1, false)}>
              Retry
            </Button>
          }
        />
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
  );
}

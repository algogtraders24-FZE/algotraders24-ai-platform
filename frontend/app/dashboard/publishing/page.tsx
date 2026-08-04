"use client";

// app/dashboard/publishing/page.tsx
// Sprint D2.3.S1 - Publishing Activation. Real, per-user, DB-backed articles
// via /api/private/publishing/articles - replaces the hardcoded mockArticles
// this page used to render (Master Audit D2.3.F, Critical finding #1: no
// persistence, no working Publish/Schedule). "Generate AI Draft" still calls
// the same real sendMessage() AI service the old page did (proven live
// during the audit), it just persists the result now instead of discarding
// it into a side-panel-only aiDraft state.
import { useEffect, useMemo, useState } from "react";
import type { Article } from "@/types/article";
import type { ContentCategory } from "@/types/content-category";
import { CATEGORY_TITLES } from "@/services/ai/publishing/content-generator.service";
import { getDailySchedule } from "@/services/ai/publishing/content-planner.service";
import { sendMessage } from "@/services/ai/assistant.service";
import ArticleCard from "@/components/publishing/ArticleCard";
import SEOScoreCard from "@/components/publishing/SEOScoreCard";
import PublishingQueue from "@/components/publishing/PublishingQueue";
import ArticlePreview from "@/components/publishing/ArticlePreview";
import ContentCalendar from "@/components/publishing/ContentCalendar";

// Simple, client-side default keyword sets (buildSeo requires >=3 for a
// clean validateArticle pass) - not shared service logic, so kept local
// rather than added to services/ai/publishing/*.
const DEFAULT_KEYWORDS: Record<ContentCategory, string[]> = {
  "technical-analysis": ["technical analysis", "chart patterns", "indicators"],
  "fundamental-analysis": ["fundamental analysis", "economic data", "market drivers"],
  "market-outlook": ["market outlook", "trading", "forecast"],
  "economic-preview": ["economic calendar", "central bank", "data release"],
  "forex-analysis": ["forex", "currency pairs", "fx trading"],
  "gold-analysis": ["gold", "xauusd", "gold analysis"],
  "crypto-analysis": ["crypto", "bitcoin", "ethereum"],
  "index-analysis": ["stock index", "nifty", "index trading"],
  "weekly-review": ["weekly review", "markets", "recap"],
};

export default function PublishingPage() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [category, setCategory] = useState<ContentCategory>("gold-analysis");
  const [generating, setGenerating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const schedule = useMemo(() => getDailySchedule(), []);
  const active: Article | null = articles.find((a) => a.id === activeId) ?? null;

  const load = async (signal?: AbortSignal) => {
    setState("loading");
    try {
      const res = await fetch("/api/private/publishing/articles", { signal });
      const json = await res.json();
      if (json?.status === "ok" && Array.isArray(json.data?.articles)) {
        const list = json.data.articles as Article[];
        setArticles(list);
        setActiveId((current) => current ?? list[0]?.id ?? null);
        setState("ready");
      } else {
        setState("error");
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setState("error");
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, []);

  const published = articles.filter((a) => a.status === "published");
  const avgSeo = articles.length > 0 ? Math.round(articles.reduce((s, a) => s + (a.seo.score ?? 0), 0) / articles.length) : 0;

  const generateDraft = async () => {
    setGenerating(true);
    setActionError(null);
    try {
      const title = CATEGORY_TITLES[category];
      // Sprint D2.3.S4 - sendMessage() posts to /api/private/knowledge/chat,
      // which now always applies AI_COMMUNICATION_POLICY as a system
      // instruction (see that route) - this line is a Publishing-specific
      // reinforcement on top of that, not a duplicate of the full policy.
      const prompt = `Write a short professional market research article titled "${title}". Cover overview, key levels, and outlook. Under 200 words. Use hedged, evidence-based language (e.g. "current evidence favors a bullish scenario"), never a directive like "Buy Gold". Add a one-line risk disclaimer.`;
      const aiRes = await sendMessage({ conversationId: "publishing", message: prompt });

      const res = await fetch("/api/private/publishing/articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, keywords: DEFAULT_KEYWORDS[category], aiOverviewText: aiRes.message.content }),
      });
      const json = await res.json();
      if (json?.status === "ok" && json.data?.article) {
        await load();
        setActiveId(json.data.article.id);
      } else {
        setActionError(json?.error?.message ?? "Could not generate a draft.");
      }
    } catch {
      setActionError("Could not generate a draft.");
    } finally {
      setGenerating(false);
    }
  };

  const handlePublish = async (id: string) => {
    setActionError(null);
    const res = await fetch(`/api/private/publishing/articles/${id}/publish`, { method: "POST" });
    const json = await res.json();
    if (json?.status === "ok") {
      await load();
    } else {
      setActionError(json?.error?.details?.issues?.join(" ") ?? json?.error?.message ?? "Could not publish this article.");
    }
  };

  const handleSchedule = async (id: string, scheduledFor: string) => {
    setActionError(null);
    const res = await fetch(`/api/private/publishing/articles/${id}/schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduledFor }),
    });
    const json = await res.json();
    if (json?.status === "ok") {
      await load();
    } else {
      setActionError(json?.error?.details?.issues?.join(" ") ?? json?.error?.message ?? "Could not schedule this article.");
    }
  };

  const handleDuplicate = async (id: string) => {
    setActionError(null);
    const res = await fetch(`/api/private/publishing/articles/${id}/duplicate`, { method: "POST" });
    const json = await res.json();
    if (json?.status === "ok" && json.data?.article) {
      await load();
      setActiveId(json.data.article.id);
    } else {
      setActionError(json?.error?.message ?? "Could not duplicate this article.");
    }
  };

  return (
    <div className="min-h-screen bg-ink p-6 text-text">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">AI Publishing & SEO</h1>
            <p className="text-xs text-text-3">Automated market research</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ContentCategory)}
              className="rounded-lg border border-border bg-ink-2 px-3 py-2 text-sm text-text"
              aria-label="Article category"
            >
              {Object.entries(CATEGORY_TITLES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button
              onClick={generateDraft}
              disabled={generating}
              className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-ink hover:brightness-110 disabled:opacity-50"
            >
              {generating ? "Generating…" : "Generate AI Draft"}
            </button>
          </div>
        </header>

        {actionError && (
          <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{actionError}</div>
        )}

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-border bg-ink-2 p-4">
            <p className="text-xs text-text-3">Published</p>
            <p className="mt-1 text-2xl font-bold text-text">{published.length}</p>
          </div>
          <SEOScoreCard score={avgSeo} />
          <div className="rounded-xl border border-border bg-ink-2 p-4">
            <p className="text-xs text-text-3">Total Articles</p>
            <p className="mt-1 text-2xl font-bold text-text">{articles.length}</p>
          </div>
        </section>

        {state === "loading" ? (
          <div className="rounded-xl border border-border bg-ink-2 p-6 text-sm text-text-3">Loading articles...</div>
        ) : state === "error" ? (
          <div className="rounded-xl border border-danger/30 bg-danger/10 p-6 text-sm text-danger">
            Could not load articles. Try refreshing.
          </div>
        ) : articles.length === 0 ? (
          <div className="rounded-xl border border-border bg-ink-2 p-8 text-center">
            <p className="text-sm font-semibold text-text">No articles yet</p>
            <p className="mt-1 text-xs text-text-3">Pick a category above and generate your first AI draft.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="space-y-3 lg:col-span-1">
              <h2 className="text-sm font-semibold text-text-2">Articles</h2>
              {articles.map((a) => (
                <ArticleCard key={a.id} article={a} onOpen={setActiveId} />
              ))}
              <ContentCalendar schedule={schedule} />
            </div>

            <div className="lg:col-span-2">
              <ArticlePreview article={active} onPublish={handlePublish} onSchedule={handleSchedule} onDuplicate={handleDuplicate} />
            </div>
          </div>
        )}

        {articles.length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-semibold text-text-2">Publishing Queue</h2>
            <PublishingQueue articles={articles} />
          </section>
        )}
      </div>
    </div>
  );
}

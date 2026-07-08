"use client";

import { useMemo, useState } from "react";
import type { Article } from "@/types/article";
import { mockArticles } from "@/data/mock-articles";
import { getDailySchedule } from "@/services/ai/publishing/content-planner.service";
import { sendMessage } from "@/services/ai/assistant.service";
import ArticleCard from "@/components/publishing/ArticleCard";
import SEOScoreCard from "@/components/publishing/SEOScoreCard";
import PublishingQueue from "@/components/publishing/PublishingQueue";
import ArticlePreview from "@/components/publishing/ArticlePreview";
import ContentCalendar from "@/components/publishing/ContentCalendar";

export default function PublishingPage() {
  const articles = mockArticles;
  const schedule = useMemo(() => getDailySchedule(), []);
  const [activeId, setActiveId] = useState<string | null>(articles[0]?.id ?? null);
  const [aiDraft, setAiDraft] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const active: Article | null = articles.find((a) => a.id === activeId) ?? null;

  const published = articles.filter((a) => a.status === "published");
  const avgSeo = Math.round(articles.reduce((s, a) => s + a.seo.score, 0) / articles.length);

  const generateDraft = async () => {
    if (!active) return;
    setLoading(true);
    setAiDraft(null);
    try {
      const prompt = `Write a short professional market research article titled "${active.title}". Cover overview, key levels, and outlook. Under 200 words. Add a one-line risk disclaimer.`;
      const res = await sendMessage({ conversationId: "publishing", message: prompt });
      setAiDraft(res.message.content);
    } catch {
      setAiDraft(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">AI Publishing & SEO</h1>
            <p className="text-xs text-slate-500">Automated market research - mock data</p>
          </div>
          <button
            onClick={generateDraft}
            disabled={loading || !active}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {loading ? "Generating..." : "Generate AI Draft"}
          </button>
        </header>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <p className="text-xs text-slate-500">Published</p>
            <p className="mt-1 text-2xl font-bold text-slate-100">{published.length}</p>
          </div>
          <SEOScoreCard score={avgSeo} />
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <p className="text-xs text-slate-500">Total Articles</p>
            <p className="mt-1 text-2xl font-bold text-slate-100">{articles.length}</p>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-3 lg:col-span-1">
            <h2 className="text-sm font-semibold text-slate-300">Todays Articles</h2>
            {articles.map((a) => (
              <ArticleCard key={a.id} article={a} onOpen={setActiveId} />
            ))}
            <ContentCalendar schedule={schedule} />
          </div>

          <div className="lg:col-span-2">
            <ArticlePreview article={active} aiDraft={aiDraft} />
          </div>
        </div>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-slate-300">Publishing Queue</h2>
          <PublishingQueue articles={articles} />
        </section>
      </div>
    </div>
  );
}

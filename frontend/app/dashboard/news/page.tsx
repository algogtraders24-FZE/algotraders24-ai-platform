// app/dashboard/news/page.tsx
"use client";

import { useMemo, useState } from "react";
import type { NewsCategory } from "@/types/news";
import { getLatestNews } from "@/services/ai/news.service";
import { getHighImpactEvents } from "@/services/ai/economic-calendar.service";
import { getMarketImpactSummary } from "@/services/ai/headline-analysis.service";
import NewsCard from "@/components/news/NewsCard";
import EconomicCalendar from "@/components/news/EconomicCalendar";
import HeadlineSummary from "@/components/news/HeadlineSummary";
import NewsFilter from "@/components/news/NewsFilter";

export default function NewsPage() {
  const [category, setCategory] = useState<NewsCategory | "all">("all");

  const all = useMemo(() => getLatestNews(50), []);
  const events = useMemo(() => getHighImpactEvents(), []);
  const summary = useMemo(() => getMarketImpactSummary(), []);

  const filtered = useMemo(
    () => all.filter((n) => category === "all" || n.category === category),
    [all, category]
  );

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6">
          <h1 className="text-2xl font-bold">AI Financial News</h1>
          <p className="text-sm text-slate-500">AI-analyzed headlines & economic calendar · mock data</p>
        </header>

        <div className="mb-6">
          <HeadlineSummary summary={summary} />
        </div>

        <div className="mb-4">
          <NewsFilter value={category} onChange={setCategory} />
        </div>

        <section className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((n) => (
            <NewsCard key={n.id} article={n} />
          ))}
          {filtered.length === 0 && (
            <p className="col-span-full text-sm text-slate-500">No news matches the filter.</p>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-slate-300">High Impact Economic Events</h2>
          <EconomicCalendar events={events} />
        </section>
      </div>
    </div>
  );
}
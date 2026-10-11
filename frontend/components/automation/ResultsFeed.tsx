"use client";

// components/automation/ResultsFeed.tsx
// AT24 Automation Phase 2 - "what my automations concluded": the newest
// results, readable, each linking to the run that produced it. Pure view over
// GET /api/private/automations/results (server-side briefs, ownership-scoped).
import { useEffect, useState } from "react";
import Link from "next/link";
import { AutomationApi, type ResultItem } from "@/services/api/AutomationApi";
import Card from "@/components/ui/Card";

export function ResultsFeed({ limit = 5, showAllLink = true }: { limit?: number; showAllLink?: boolean }) {
  const [items, setItems] = useState<ResultItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    AutomationApi.results(limit)
      .then((d) => live && setItems(d.items))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [limit]);

  if (failed) return null;
  if (items === null) return <p className="text-sm text-text-3">Loading results…</p>;
  if (items.length === 0) {
    return (
      <Card>
        <p className="text-sm text-text-3">No results yet. When an automation finishes with something to report, it shows up here.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((r) => (
        <Card key={r.artifactId}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-text-3">
                {r.automationName ?? "Automation"} · {new Date(r.createdAt).toLocaleString()}
              </p>
              <h3 className="mt-1 font-semibold text-text">{r.brief.headline}</h3>
            </div>
            <Link href={`/dashboard/automation/runs/${r.runId}`} className="shrink-0 text-xs text-gold hover:underline">
              Open run →
            </Link>
          </div>
          {r.brief.lines.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm text-text-2">
              {r.brief.lines.map((l, i) => (
                <li key={i}>• {l}</li>
              ))}
            </ul>
          )}
          {r.brief.disclaimer && <p className="mt-2 text-[11px] leading-snug text-text-3">{r.brief.disclaimer}</p>}
        </Card>
      ))}
      {showAllLink && (
        <Link href="/dashboard/automation/results" className="inline-block text-xs text-gold hover:underline">
          See all results →
        </Link>
      )}
    </div>
  );
}

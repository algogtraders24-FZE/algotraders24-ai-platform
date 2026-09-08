"use client";

// app/dashboard/algo-test-library/page.tsx
// P4.8-T3.4.2 (docs/P4.8-T3-STRATEGY-LIBRARY.md) - Strategy Library for
// Algo Testing Pro. A client component specifically so it goes through
// fetchStrategyLibrary() (P4.8-T3.3's GET /strategy-library) - the same
// "give the already-real endpoint its first client-side consumer"
// reasoning P4.7-T2 already established for Run History. Mirrors that
// exact same page shape (EmptyState + Badge + card-row Link list,
// app/dashboard/algo-test-history/page.tsx) - not a new UI pattern.
//
// Deliberately bounded, per the locked T3.4 scope: no filters, no
// sorting, no run-again action, no editing/versioning/clone/favorites/
// tags, no best-metric display. Every row links to this Strategy's own
// detail page - never a second reopen/rerun code path.
import { useEffect, useState } from "react";
import Link from "next/link";
import EmptyState from "@/components/ui/EmptyState";
import ButtonLink from "@/components/ui/ButtonLink";
import Badge, { type BadgeTone } from "@/components/ui/Badge";
import { fetchStrategyLibrary } from "@/lib/algo-test/store";
import { formatTimestamp } from "@/lib/financial-format";
import type { AlgoTestStrategyOrigin, StrategyLibraryItem } from "@/types/algo-test";

function originTone(origin: AlgoTestStrategyOrigin): BadgeTone {
  return origin === "registry" ? "info" : "gold";
}

function toEpoch(iso: string): number {
  return Date.parse(iso);
}

export default function AlgoTestLibraryPage() {
  const [strategies, setStrategies] = useState<StrategyLibraryItem[] | null>(null);

  useEffect(() => {
    fetchStrategyLibrary().then(setStrategies);
  }, []);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text">Strategy Library</h1>
        <p className="mt-1 text-sm text-text-2">Every strategy available to Algo Testing Pro - built-in registry strategies and your own AI-compiled ones.</p>
      </div>

      {strategies === null ? null : strategies.length === 0 ? (
        <EmptyState
          title="No strategies yet."
          description="Compile a strategy from Algo Testing Pro and it will show up here."
          action={<ButtonLink href="/dashboard/workspace">Go to Algo Testing Pro</ButtonLink>}
        />
      ) : (
        <div className="space-y-3">
          {strategies.map((strategy) => (
            <Link
              key={strategy.strategyId}
              href={`/dashboard/algo-test-library/${encodeURIComponent(strategy.strategyId)}`}
              className="block rounded-2xl border border-border bg-ink-2 p-5 transition hover:border-gold"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-text" title={strategy.strategyId}>
                  {strategy.name}
                </p>
                <Badge tone={originTone(strategy.origin)}>{strategy.origin}</Badge>
              </div>
              <p className="mt-1 text-xs text-text-3">
                {strategy.runCount} {strategy.runCount === 1 ? "run" : "runs"}
                {strategy.lastRunAt ? ` · last run ${formatTimestamp(toEpoch(strategy.lastRunAt), "datetime")}` : " · never run"}
              </p>
              {strategy.createdAt && <p className="mt-1 text-[11px] text-text-3">Created {formatTimestamp(toEpoch(strategy.createdAt), "datetime")}</p>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

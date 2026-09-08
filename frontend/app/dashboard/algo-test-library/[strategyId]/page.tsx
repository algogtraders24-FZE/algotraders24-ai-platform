"use client";

// app/dashboard/algo-test-library/[strategyId]/page.tsx
// P4.8-T3.4.2 (docs/P4.8-T3-STRATEGY-LIBRARY.md) - Strategy Library
// detail. A client component so it goes through fetchStrategyLibraryDetail()
// (P4.8-T3.3's GET /strategy-library/[strategyId]) - its first client-side
// consumer, same reasoning as the list page.
//
// Reuses the shared CompiledStrategyCard (P4.8-T3.4.1) verbatim, without
// a symbolTimeframeLabel - a bare Strategy has no run to source that
// from. Never renders compiledStrategy when artifactVerified is false -
// the locked contract already makes that field genuinely absent in that
// case; this page does not "work around" that, it presents it honestly
// (a warning, per the locked badge-tone decision) instead.
//
// No run-again action, no editing/versioning/clone/favorites/tags, no
// best-metric display - all explicitly out of the locked T3.4 scope.
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import EmptyState from "@/components/ui/EmptyState";
import ButtonLink from "@/components/ui/ButtonLink";
import Badge, { type BadgeTone } from "@/components/ui/Badge";
import CompiledStrategyCard from "@/components/algo-test/CompiledStrategyCard";
import { fetchStrategyLibraryDetail } from "@/lib/algo-test/store";
import { formatTimestamp } from "@/lib/financial-format";
import type { AlgoTestStrategyOrigin, StrategyLibraryDetail } from "@/types/algo-test";

function originTone(origin: AlgoTestStrategyOrigin): BadgeTone {
  return origin === "registry" ? "info" : "gold";
}

function toEpoch(iso: string): number {
  return Date.parse(iso);
}

export default function AlgoTestLibraryDetailPage() {
  const params = useParams<{ strategyId: string }>();
  const strategyId = decodeURIComponent(params.strategyId);
  const [detail, setDetail] = useState<StrategyLibraryDetail | null | undefined>(null);

  useEffect(() => {
    setDetail(null);
    fetchStrategyLibraryDetail(strategyId).then((result) => setDetail(result ?? undefined));
  }, [strategyId]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/dashboard/algo-test-library" className="text-xs text-text-3 hover:text-gold">
        ← Strategy Library
      </Link>

      {detail === null ? null : detail === undefined ? (
        <EmptyState
          title="Strategy not found."
          description="It may not exist, or it may belong to someone else."
          action={<ButtonLink href="/dashboard/algo-test-library">Back to Strategy Library</ButtonLink>}
        />
      ) : (
        <div className="space-y-4">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h1 className="text-2xl font-bold text-text">{detail.name}</h1>
              <Badge tone={originTone(detail.origin)}>{detail.origin}</Badge>
            </div>
            <p className="mt-1 text-sm text-text-2">
              {detail.runCount} {detail.runCount === 1 ? "run" : "runs"}
              {detail.lastRunAt ? ` · last run ${formatTimestamp(toEpoch(detail.lastRunAt), "datetime")}` : " · never run"}
            </p>
            {detail.createdAt && <p className="mt-1 text-xs text-text-3">Created {formatTimestamp(toEpoch(detail.createdAt), "datetime")}</p>}
          </div>

          {detail.artifactVerified && detail.compiledStrategy ? (
            <CompiledStrategyCard strategy={detail.compiledStrategy} />
          ) : (
            <div className="rounded-control border border-dashed border-warning/30 bg-warning/10 px-2.5 py-2">
              <p className="text-xs font-medium uppercase tracking-wide text-warning">Compiled Strategy</p>
              <p className="mt-1 text-[11px] text-warning">This strategy&apos;s persisted artifact could not currently be verified - it exists and can still be identified, but its executable details cannot be shown right now.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

"use client";
// app/quant-lite/library/LibraryBrowser.tsx
// Sprint Q0.8 - client-side filtering over the static real sample
// (Q0.7_UI_INFORMATION_ARCHITECTURE Part 10: filters are a query
// convenience, never presented as validation).
import { useMemo, useState } from "react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Select from "@/components/ui/Select";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import LegacyEvidenceBadge from "@/components/quant-lite/LegacyEvidenceBadge";
import { FIN_PRIMARY, financialDirectionClass } from "@/components/ui/financial-typography";
import type { LibraryEntry } from "@/types/quant-lite";

export default function LibraryBrowser({ entries }: { entries: LibraryEntry[] }) {
  const [triggerFilter, setTriggerFilter] = useState("all");
  const [symbolFilter, setSymbolFilter] = useState("all");
  const [timeframeFilter, setTimeframeFilter] = useState("all");

  const triggers = useMemo(() => Array.from(new Set(entries.map((e) => e.triggerKey))).sort(), [entries]);
  const symbols = useMemo(() => Array.from(new Set(entries.map((e) => e.symbol))).sort(), [entries]);
  const timeframes = useMemo(() => Array.from(new Set(entries.map((e) => e.timeframe))).sort(), [entries]);

  const filtered = entries.filter(
    (e) =>
      (triggerFilter === "all" || e.triggerKey === triggerFilter) &&
      (symbolFilter === "all" || e.symbol === symbolFilter) &&
      (timeframeFilter === "all" || e.timeframe === timeframeFilter),
  );

  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-3">
        <Select value={triggerFilter} onChange={(e) => setTriggerFilter(e.target.value)}>
          <option value="all">All indicators</option>
          {triggers.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
        <Select value={symbolFilter} onChange={(e) => setSymbolFilter(e.target.value)}>
          <option value="all">All markets</option>
          {symbols.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select value={timeframeFilter} onChange={(e) => setTimeframeFilter(e.target.value)}>
          <option value="all">All timeframes</option>
          {timeframes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
        {(triggerFilter !== "all" || symbolFilter !== "all" || timeframeFilter !== "all") && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setTriggerFilter("all");
              setSymbolFilter("all");
              setTimeframeFilter("all");
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No strategies match these filters"
          description="Try clearing one or more filters."
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setTriggerFilter("all");
                setSymbolFilter("all");
                setTimeframeFilter("all");
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((entry) => (
            <Link key={entry.id} href={`/quant-lite/library/${entry.id}`}>
              <Card className="h-full transition hover:border-gold/50">
                <div className="mb-2">
                  <LegacyEvidenceBadge />
                </div>
                <p className="text-sm font-semibold text-text">{entry.triggerKey.replace(/_/g, " ")}</p>
                <p className="text-xs text-text-3">
                  {entry.filterKey !== "none" ? `+ ${entry.filterKey.replace(/_/g, " ")} filter` : "No filter"} &middot; {entry.riskPreset}
                </p>
                <p className="mt-1 text-xs text-text-3">
                  {entry.symbol} &middot; {entry.timeframe}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <p className="text-text-3">Profit Factor</p>
                    <p className={FIN_PRIMARY}>{entry.profitFactor.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-text-3">Return</p>
                    <p className={[FIN_PRIMARY, financialDirectionClass(entry.totalReturnPct >= 0 ? "up" : "down")].join(" ")}>
                      {entry.totalReturnPct >= 0 ? "+" : ""}
                      {entry.totalReturnPct.toFixed(2)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-text-3">Max Drawdown</p>
                    <p className={FIN_PRIMARY}>{entry.maxDrawdownPct.toFixed(2)}%</p>
                  </div>
                  <div>
                    <p className="text-text-3">Trades</p>
                    <p className={FIN_PRIMARY}>{entry.tradesTotal}</p>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

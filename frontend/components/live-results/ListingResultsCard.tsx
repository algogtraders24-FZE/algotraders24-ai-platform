// components/live-results/ListingResultsCard.tsx
// Shown on a marketplace listing when its seller attached a PUBLIC Live Results page: the real, ongoing
// record of the EA on a live data feed. It is separate from the listing's Trust State and never changes it.
import Link from "next/link";
import type { ListingResultsSummary } from "@/services/live-results/follow-store";

const pct = (n: number | null) => (n === null ? "-" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`);
const tone = (n: number | null) => (n === null || n === 0 ? "text-text" : n > 0 ? "text-emerald-400" : "text-red-400");
const utc = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC";

export default function ListingResultsCard({ items }: { items: ListingResultsSummary[] }) {
  if (items.length === 0) return null;
  return (
    <section className="mx-auto max-w-6xl px-6 pb-12">
      <div className="space-y-4 rounded-xl border border-border bg-ink-2 p-5">
        <div>
          <h2 className="text-lg font-bold text-text">Live results of this EA</h2>
          <p className="text-sm text-text-2">The EA running on a live data feed, reported by the seller&apos;s own MetaTrader terminal and updated automatically. It is a separate record from the validation above and does not change the listing&apos;s trust state.</p>
        </div>
        {items.map((r) => (
          <div key={r.slug} className="space-y-3 rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-text">{r.title}</p>
              <span className={`rounded-full border px-2 py-0.5 text-xs ${r.mode === "real" ? "border-amber-600 text-amber-300" : "border-amber-400 font-bold text-amber-400"}`}>{r.mode === "real" ? "REAL account" : r.mode === "contest" ? "CONTEST account" : "DEMO account"}</span>
              <span className={`rounded-full border px-2 py-0.5 text-xs ${r.stale ? "border-amber-600 text-amber-300" : "border-emerald-700 text-emerald-400"}`}>{r.stale ? `not reporting · last update ${utc(r.lastSyncAt)}` : "● live"}</span>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-text-3">Live forward record</p>
                <p className="text-sm text-text">
                  {r.liveTracked.trades > 0 ? (
                    <>
                      <b className={tone(r.liveTracked.gainPct)}>{pct(r.liveTracked.gainPct)}</b> over {r.liveTracked.trades} closed trade{r.liveTracked.trades === 1 ? "" : "s"}
                    </>
                  ) : (
                    "No trade has closed since live tracking started."
                  )}
                </p>
                <p className="text-xs text-text-3">Tracked for {r.daysSinceFirstSync} day{r.daysSinceFirstSync === 1 ? "" : "s"}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-text-3">Max drawdown (reported history)</p>
                <p className="text-sm font-semibold text-red-400">{r.maxDrawdownPct.toFixed(1)}%</p>
                {r.historyDays !== null && r.historyDays > 0 && <p className="text-xs text-text-3">History of {r.historyDays} days was reported at first connect</p>}
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-text-3">Skill or luck?</p>
                <p className="text-sm font-semibold capitalize text-text">{r.edgeLevel ? `${r.edgeLevel} evidence of edge` : "not enough trades yet"}</p>
                {r.filteredByMagic && <p className="text-xs text-text-3">Shows this EA only</p>}
              </div>
            </div>
            <Link href={`/results/${r.slug}`} className="inline-block text-sm font-semibold text-gold hover:underline">Open the full live results →</Link>
          </div>
        ))}
        <p className="text-xs text-text-3">Terminal-reported and not independently verified by a broker or by AT24. Past results do not predict future results. This is not investment advice.</p>
      </div>
    </section>
  );
}

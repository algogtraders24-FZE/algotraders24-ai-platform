// components/marketplace/ReportCheckCard.tsx
// Shown on a listing when the seller attached an MT5 Strategy Tester report and the AT24 worker finished reading it.
// Honest by construction: it says what was checked (the report's own numbers agree with each other) and what was NOT
// (that the backtest ran on real market data). It is separate from the independent Trust State and never shows VALIDATED.
import type { PublicReportCheck } from "@/services/marketplace/reportCheckStore";
import { reportCheckLabel } from "@/lib/marketplace/reportCheck";

const money = (n: number | null) => (n === null ? "-" : n.toLocaleString("en-US", { maximumFractionDigits: 2 }));
const pct = (n: number | null) => (n === null ? "-" : `${(n * 100).toFixed(1)}%`);
const day = (s: string | null) => (s ? s.slice(0, 10) : "-");

export interface LiveCompare {
  mode: string;
  maxDrawdownPct: number | null; // percent, e.g. 12.3
  trades: number;
  daysTracked: number;
}

export default function ReportCheckCard({ check, live }: { check: PublicReportCheck | null; live?: LiveCompare | null }) {
  if (!check) return null;
  const r = check.result;
  return (
    <section id="report-check" className="mx-auto max-w-6xl scroll-mt-28 px-6 pb-12">
      <div className="space-y-4 rounded-xl border border-border bg-ink-2 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold text-text">Seller&apos;s backtest report</h2>
          <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${r.consistent ? "border-sky-600 text-sky-300" : "border-amber-600 text-amber-300"}`}>{reportCheckLabel(r)}</span>
        </div>
        <p className="text-sm text-text-2">
          The seller attached the MT5 Strategy Tester report. AT24 re-added every trade in its deals list and compared the result with the
          summary printed in the same report.{" "}
          {r.consistent ? "The figures agree." : "The figures do NOT all agree - treat this report with caution."} This does not prove the test ran on
          real market data, and it is not the independent Trust State above.
        </p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Net profit" value={money(r.metrics.netProfit)} />
          <Stat label="Trades" value={money(r.metrics.tradeCount)} />
          <Stat label="Profit factor" value={r.metrics.profitFactor === null ? "-" : r.metrics.profitFactor.toFixed(2)} />
          <Stat label="Win rate" value={pct(r.metrics.winRate)} />
          <Stat label="Max drawdown" value={pct(r.metrics.maxDrawdownPercent)} />
          <Stat label="Recovery factor" value={r.metrics.recoveryFactor === null ? "-" : r.metrics.recoveryFactor.toFixed(2)} />
          <Stat label="Symbol" value={r.symbol ?? "-"} />
          <Stat label="Period" value={`${day(r.periodStart)} to ${day(r.periodEnd)}`} />
        </div>
        {live && live.maxDrawdownPct !== null && r.metrics.maxDrawdownPercent !== null && (
          <p className="rounded-lg border border-border p-3 text-sm text-text-2">
            <b className="text-text">Report vs live:</b> max drawdown {(r.metrics.maxDrawdownPercent * 100).toFixed(1)}% in the report; {live.maxDrawdownPct.toFixed(1)}% on the attached{" "}
            {live.mode === "real" ? "real" : "demo"} account ({live.trades} live trades tracked over {live.daysTracked} days). Different periods and measuring methods,
            so read it as a rough sanity check, not a like-for-like match. See the live results below.
          </p>
        )}
        {r.flags.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-sm text-amber-300">
            {r.flags.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}
        <p className="text-xs text-text-3">
          Backtest results are historical and edited reports are possible; past results do not predict future results. Checked {check.checkedAt.slice(0, 10)}.
          This is not investment advice.
        </p>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-text-3">{label}</p>
      <p className="text-sm font-semibold text-text">{value}</p>
    </div>
  );
}

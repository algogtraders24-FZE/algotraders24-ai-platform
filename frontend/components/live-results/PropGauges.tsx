// components/live-results/PropGauges.tsx
// Prop Mode: four ring gauges (trading days, daily loss, max loss, profit target) + one honest status line.
// Server component. Everything is a percent of the initial deposit, computed in services/live-results/prop.ts.
import { PROP_DISCLAIMER, type PropCheck } from "@/services/live-results/prop";

function Ring({ label, valueText, sub, fraction, tone }: { label: string; valueText: string; sub: string; fraction: number; tone: "ok" | "warn" | "bad" }) {
  const R = 30, C = 2 * Math.PI * R;
  const f = Math.max(0, Math.min(1, fraction));
  const color = tone === "bad" ? "stroke-red-400" : tone === "warn" ? "stroke-amber-400" : "stroke-emerald-400";
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-ink-2 p-3">
      <svg viewBox="0 0 76 76" className="h-16 w-16 shrink-0" role="img" aria-label={`${label}: ${valueText}`}>
        <circle cx="38" cy="38" r={R} fill="none" strokeWidth="7" className="stroke-white/10" />
        <circle cx="38" cy="38" r={R} fill="none" strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(f * C).toFixed(1)} ${C.toFixed(1)}`} transform="rotate(-90 38 38)" className={color} />
        <text x="38" y="42" textAnchor="middle" fontSize="12" fontWeight="700" className="fill-text">{Math.round(f * 100)}%</text>
      </svg>
      <div className="min-w-0">
        <div className="text-xs text-text-3">{label}</div>
        <div className="text-sm font-bold tabular-nums text-text">{valueText}</div>
        <div className="text-[11px] text-text-3">{sub}</div>
      </div>
    </div>
  );
}

export default function PropGauges({ check }: { check: PropCheck }) {
  const { rules: r } = check;
  const daysDone = r.minTradingDays === 0 ? 1 : check.tradingDays / r.minTradingDays;
  const dailyFrac = check.worstDailyLossPct / r.dailyLossPct;
  const maxFrac = check.maxLossUsedPct / r.maxLossPct;
  const lossTone = (f: number): "ok" | "warn" | "bad" => (f >= 1 ? "bad" : f >= 0.7 ? "warn" : "ok");

  let status: { text: string; cls: string };
  if (check.state === "no_deposit") status = { text: "Needs an initial deposit in the synced history to measure percentages.", cls: "text-text-3" };
  else if (check.state === "rule_broken") status = { text: `A loss rule was broken on ${check.brokenOn} (${check.brokenRule === "daily_loss" ? "daily loss limit" : "max loss limit"}).`, cls: "text-red-400" };
  else if (check.state === "target_reached") status = { text: "Profit target and minimum trading days reached with no loss rule broken so far.", cls: "text-emerald-400" };
  else status = { text: "In progress: no loss rule broken so far.", cls: "text-amber-300" };

  return (
    <section className="rounded-xl border border-border bg-ink p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-text">Prop Mode <span className="ml-2 text-xs font-normal text-text-3">rule check: target {r.profitTargetPct}% · daily loss {r.dailyLossPct}% · max loss {r.maxLossPct}% · {r.minTradingDays} days</span></h2>
        <span className={`text-sm font-semibold ${status.cls}`}>{status.text}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Ring label="Trading days" valueText={`${check.tradingDays} / ${r.minTradingDays}`} sub={check.tradingDays >= r.minTradingDays ? "minimum reached" : "days with a closed trade"} fraction={daysDone} tone={check.tradingDays >= r.minTradingDays ? "ok" : "warn"} />
        <Ring label="Daily loss (worst day)" valueText={`${check.worstDailyLossPct.toFixed(2)}% of ${r.dailyLossPct}%`} sub={check.worstDailyLossDate ? `worst day ${check.worstDailyLossDate}` : "no losing day"} fraction={dailyFrac} tone={lossTone(dailyFrac)} />
        <Ring label="Max loss (deepest)" valueText={`${check.maxLossUsedPct.toFixed(2)}% of ${r.maxLossPct}%`} sub="below the initial deposit" fraction={maxFrac} tone={lossTone(maxFrac)} />
        <Ring label="Profit target" valueText={`${check.profitPct > 0 ? "+" : ""}${check.profitPct.toFixed(2)}% of ${r.profitTargetPct}%`} sub={check.state === "target_reached" ? "reached" : "of the initial deposit"} fraction={check.targetProgressPct / 100} tone={check.profitPct >= r.profitTargetPct ? "ok" : "warn"} />
      </div>
      <p className="mt-3 text-[11px] text-text-3">{PROP_DISCLAIMER}</p>
    </section>
  );
}

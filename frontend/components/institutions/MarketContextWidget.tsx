// components/institutions/MarketContextWidget.tsx
// Prototype of the partner "Market Context" widget: one compact card per instrument built only from the numbers the public market hub already
// computes (range with its self-check, key levels, macro alignment, next risk event). Never a direction call. A partner version is branded and
// keyed; this one is shown on the demo page only. Sections whose source is down are left out, never estimated.
import { getMarketHub } from "@/services/markets/production";
import type { MarketDef } from "@/services/markets/hub";
import { MIN_SAMPLE, TARGET_COVERAGE, type CalibrationRow } from "@/services/calibration/forecast";

const pct = (v: number | null) => (v === null ? "-" : `${(v * 100).toFixed(0)}%`);

function selfCheck(row: CalibrationRow | null): string {
  if (!row || row.n === 0) return `Self-check: collecting data (a verdict appears after ${MIN_SAMPLE} checked forecasts).`;
  if (row.status === "collecting") return `Self-check: ${row.n} checked so far, ${pct(row.rate)} stayed inside. Too few for a verdict.`;
  return `Self-check: ${pct(row.rate)} stayed inside over ${row.n} checked forecasts (target ${TARGET_COVERAGE * 100}%).`;
}

export default async function MarketContextWidget({ def }: { def: MarketDef }) {
  const v = await getMarketHub(def);
  const next = v.events[0];
  return (
    <div className="rounded-panel border border-border bg-ink-2 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-base font-semibold">{def.longName}</h3>
        <p className="font-mono text-lg">
          {v.price ? v.price.text : "unavailable"}
          {v.price && v.price.changePct !== null && (
            <span className={`ml-2 text-sm ${v.price.changePct >= 0 ? "text-success" : "text-danger"}`}>
              {v.price.changePct >= 0 ? "+" : ""}
              {v.price.changePct.toFixed(2)}%
            </span>
          )}
        </p>
      </div>

      <div className="mt-4 border-t border-border pt-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-text-3">Typical move, about {TARGET_COVERAGE * 100}% of past moves stayed within</p>
        {v.ranges ? (
          <>
            <p className="mt-1 font-mono text-sm">{v.ranges.r12}</p>
            <p className="font-mono text-sm">{v.ranges.r24}</p>
            {v.ranges.widenedNote && <p className="mt-1 text-xs text-gold">{v.ranges.widenedNote}</p>}
            <p className="mt-1 text-xs text-text-3">{selfCheck(v.calibration.row12)}</p>
          </>
        ) : (
          <p className="mt-1 text-sm text-text-2">Unavailable right now (not enough recent price data).</p>
        )}
      </div>

      {v.levels && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-text-3">Key levels</p>
          <p className="mt-1 text-sm leading-6 text-text-2">{v.levels}.</p>
        </div>
      )}

      {v.macro && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-text-3">Macro alignment</p>
          <p className="mt-1 text-sm leading-6 text-text-2">
            <span className="font-semibold text-text">{v.macro.label}</span>
            {v.macro.score !== null ? ` (${v.macro.score}% of driver weight points the same way)` : ""}. A rule-based agreement of drivers, not a forecast.
          </p>
        </div>
      )}

      {next && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-text-3">Next high-impact event</p>
          <p className="mt-1 text-sm text-text-2">
            {next.currency} {next.title} <span className="text-text-3">({next.inText})</span>
          </p>
        </div>
      )}

      <p className="mt-4 text-[11px] leading-4 text-text-3">Information only. Not investment advice or a recommendation to buy or sell.</p>
    </div>
  );
}

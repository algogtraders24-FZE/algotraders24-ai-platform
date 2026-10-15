// services/evidence-sources/smc-evidence-source.ts
// "technical" evidence from the SMC structure engine (services/smc): the market
// structure facts - bias, last BOS/MSS, higher-timeframe bias, fresh liquidity
// sweep, nearest unswept liquidity, active order block / fair value gap, location
// in the swing range, volatility regime - plus one summary line with the structure
// lean and score.
//
// This is structure, not a trade signal: no BUY/SELL, no entry / stop / target. The
// score's weights are a heuristic that has not been validated against outcomes, and
// the summary says so. All items share ONE source name (the ranking stage flags
// same-type items from different sources with different text as conflicts).

import { ATR_RATIO_UNIT, type EvidenceItem } from "@/types/evidence";
import type { EvidenceExtraSource, EvidenceProviderRequest } from "@/types/evidence-fusion";
import type { SmcAnalysis, SmcZone } from "@/services/smc/smc-engine";
import { fmtPrice, fmtDist, RANGE_MULT_80, rangesFor, rangeText, type EventContext, type RangeEvent } from "@/services/smc/expected-range";

export const SMC_EVIDENCE_SOURCE = "AT24 SMC structure";

export interface SmcEvidenceDeps {
  getAnalysis?: (symbol: string) => Promise<SmcAnalysis | null>;
  /** USD high-impact calendar events (this week); null when the feed is unavailable. Used to widen the typical-move band around releases. */
  getEvents?: () => Promise<readonly RangeEvent[] | null>;
  now?: () => Date;
}

async function defaultGetAnalysis(symbol: string): Promise<SmcAnalysis | null> {
  const { getSmcAnalysis } = await import("@/services/smc/smc-service");
  return getSmcAnalysis(symbol);
}

async function defaultGetEvents(): Promise<readonly RangeEvent[] | null> {
  try {
    const { getEconomicCalendar } = await import("@/services/calendar/calendar.service");
    return (await getEconomicCalendar({ week: "this", currencies: ["USD"], impacts: ["high"] })).events;
  } catch {
    return null; // no calendar: the plain band is used, never a guess
  }
}

export { fmtPrice, fmtDist, RANGE_MULT_80 };

const zoneText = (z: SmcZone, price: number): string => {
  const side = z.top < price ? "below" : z.bot > price ? "above" : "around";
  return `${z.dir === 1 ? "bullish" : "bearish"} ${z.kind === "OB" ? "order block" : "fair value gap"} ${fmtPrice(z.bot)}-${fmtPrice(z.top)} (${z.status}), ${side} price`;
};

export function smcClaims(a: SmcAnalysis, ctx?: EventContext): string[] {
  const out: string[] = [];

  const ev = a.lastEvent;
  const evText = ev ? `last ${ev.strong ? "" : "weak "}${ev.kind} ${ev.dir.toLowerCase()} ${ev.barsAgo} bar${ev.barsAgo === 1 ? "" : "s"} ago, close ${ev.dir === "Bullish" ? "above" : "below"} ${fmtPrice(ev.level)}` : "no structure break yet";
  out.push(`1h structure is ${a.bias.toLowerCase()} (${evText}); 4h bias ${a.htf.bias.toLowerCase()}${a.htf.event !== "--" ? ` (${a.htf.event})` : ""}`);

  if (a.sweep && a.sweep.fresh) {
    const buySide = a.sweep.kind === "EQH" || a.sweep.kind === "PDH" || a.sweep.kind === "PWH";
    out.push(`Liquidity sweep: ${a.sweep.kind} swept ${a.sweep.barsAgo} bar${a.sweep.barsAgo === 1 ? "" : "s"} ago and price closed back ${buySide ? "below" : "above"} it (${buySide ? "buy" : "sell"}-side liquidity taken)`);
  }

  if (a.nearestPool) {
    out.push(`Nearest unswept liquidity: ${a.nearestPool.kind} at ${fmtPrice(a.nearestPool.price)} (${fmtDist(a.nearestPool.distance, a.price)} ${a.nearestPool.side} price)`);
  }
  if (a.ob) out.push(`Active ${zoneText(a.ob, a.price)}`);
  if (a.fvg) out.push(`Active ${zoneText(a.fvg, a.price)}`);

  if (a.range && a.location !== "--") {
    out.push(`Price is in ${a.location} of the swing range ${fmtPrice(a.range.low)}-${fmtPrice(a.range.high)}`);
  }
  if (a.volatility !== "--" && a.volatilityRatio !== null) {
    out.push(`Volatility regime: ${a.volatility} (ATR ${a.volatilityRatio.toFixed(2)}x its recent average)`);
  }

  // Typical size of the next move (volatility clusters, so this is forecastable; direction is not). Widened when a validated
  // scheduled US release (CPI, payrolls, Fed decision) falls inside the window.
  const rng = rangesFor(a, ctx);
  if (rng) {
    const widened = rng.r12.factor > 1 || rng.r24.factor > 1;
    const note = widened
      ? `. Widened (${[rng.r12.factor > 1 ? `12h x${rng.r12.factor}` : null, rng.r24.factor > 1 ? `24h x${rng.r24.factor}` : null].filter(Boolean).join(", ")}) because ${rng.events[0].label} falls inside the window - the plain band was too narrow on past release days`
      : "";
    out.push(`Typical move size (volatility range, not a direction or target): about 80% of past moves stayed within ${rangeText(rng.r12, a.price)} and ${rangeText(rng.r24, a.price)} - checked out-of-sample on 3.7 years of Gold and Bitcoin hourly data${note}`);
  }

  const parts = a.factors.filter((f) => f.points !== 0).map((f) => `${f.label} ${f.points > 0 ? "+" : ""}${f.points}`);
  out.push(
    `SMC structure lean: ${a.lean}${a.lean === "none" ? "" : ` (${a.strength})`}, score ${a.score}/100${parts.length ? ` [${parts.join(", ")}]` : ""} - rule-based structure; backtested on 3.7 years of Gold and Bitcoin hourly data it showed no reliable directional edge, so it is descriptive only, not a trade signal`,
  );
  return out;
}

export class SmcStructureEvidenceSource implements EvidenceExtraSource {
  readonly name = "smc-structure-evidence";
  readonly sourceType = "smc-structure" as const;
  private readonly getAnalysis: (symbol: string) => Promise<SmcAnalysis | null>;
  private readonly getEvents: () => Promise<readonly RangeEvent[] | null>;
  private readonly now: () => Date;

  constructor(deps: SmcEvidenceDeps = {}) {
    this.getAnalysis = deps.getAnalysis ?? defaultGetAnalysis;
    this.getEvents = deps.getEvents ?? defaultGetEvents;
    this.now = deps.now ?? (() => new Date());
  }

  isConfigured(): boolean {
    return true;
  }

  async collect(request: EvidenceProviderRequest): Promise<EvidenceItem[]> {
    const a = await this.getAnalysis(request.symbol);
    if (!a) return []; // not enough candles: absent, never estimated
    const retrievedAt = this.now().toISOString();
    const events = await this.getEvents().catch(() => null);
    return smcClaims(a, { symbol: request.symbol, nowMs: this.now().getTime(), events }).map((claim) => ({
      type: "technical" as const,
      symbol: request.symbol,
      claim,
      source: SMC_EVIDENCE_SOURCE,
      asOf: a.lastClosedTime,
      retrievedAt,
      // The volatility line carries its measured ATR ratio so the risk engine can use it.
      ...(a.volatilityRatio !== null && claim.startsWith("Volatility regime:") ? { magnitude: a.volatilityRatio, unit: ATR_RATIO_UNIT } : {}),
    }));
  }
}

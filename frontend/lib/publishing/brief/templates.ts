// lib/publishing/brief/templates.ts
// Market Brief 2.0: turns a BriefFacts object into the article sections (plain words, calm, positive-neutral). Deterministic templates:
// no free-text model output, so every number in the post comes from the facts. Each section also carries a plain-text `body`, so an
// older renderer that only knows heading + body still shows a readable post.
import type { ArticleSection } from "@/types/article";
import { formatPrice } from "@/lib/financial-format";
import type { BriefFacts, Trend } from "./facts";

export interface PreviousBrief {
  levels: BriefFacts["scenarioLevels"];
  /** What price did after the previous brief (computed by the caller from candles after levels.time). */
  high: number;
  low: number;
  close: number;
}

export interface BriefBuildOptions {
  chartUrl?: string;
  previous?: PreviousBrief | null;
}

export interface BuiltBrief {
  title: string;
  summary: string;
  sections: ArticleSection[];
  /** Every numeric value a template wrote into the text (used by the validator to prove nothing is hard-coded). */
  usedNumbers: number[];
}

const DISCLAIMER = "Education only, not financial advice.";

export function buildBriefSections(f: BriefFacts, opts: BriefBuildOptions = {}): BuiltBrief {
  const used: number[] = [];
  const fmtP = (n: number) => formatPrice(n, { maxDecimals: Math.abs(n) >= 1000 ? 2 : Math.abs(n) >= 100 ? 3 : Math.abs(n) >= 10 ? 4 : 5 });
  /** Writes a price into the text and records it. Prices above 100 are shown without decimals for readability (the value recorded keeps the tolerance). */
  const P = (n: number) => {
    used.push(n);
    const a = Math.abs(n);
    return a >= 100 ? Math.round(n).toLocaleString("en-US") : a >= 10 ? n.toFixed(2) : a >= 1 ? n.toFixed(3) : fmtP(n);
  };
  const Q = (n: number, d = 1) => { used.push(n); return n.toFixed(d); };
  const name = f.displayName;

  // ---- headline -------------------------------------------------------------------------------------------------------------
  const s = f.shortTrend, h = f.higherTrend;
  let headline: string;
  if (s === "bullish" && h === "bullish") headline = `${name}: buyers lead on both the 1-hour and 4-hour charts`;
  else if (s === "bullish" && h === "bearish") headline = `${name}: buyers are back above the short-term averages, while the 4-hour picture is still down`;
  else if (s === "bearish" && h === "bearish") headline = `${name}: sellers lead on both the 1-hour and 4-hour charts`;
  else if (s === "bearish" && h === "bullish") headline = `${name}: a short-term dip inside a 4-hour uptrend`;
  else if (s === "bullish") headline = `${name}: the 1-hour chart is turning up, the bigger picture is still forming`;
  else if (s === "bearish") headline = `${name}: the 1-hour chart is leaning down, the bigger picture is still forming`;
  else headline = `${name}: a balanced picture, waiting for a clear move`;

  const d = new Date(f.asOfMs);
  const dateText = d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const timeText = d.toISOString().slice(11, 16);
  const sections: ArticleSection[] = [];

  sections.push({
    heading: headline,
    kind: "headline",
    body: `${dateText} · latest hourly candle ${timeText} UTC · by Algotraders24 AI (rule-based system)`,
  });

  // ---- chips ------------------------------------------------------------------------------------------------------------------
  const chips: { value: string; label: string }[] = [
    { value: P(f.price), label: f.change24hPct === null ? `${f.pair}` : `${f.pair}, ${f.change24hPct >= 0 ? "+" : ""}${Q(f.change24hPct, 2)}% in 24 hours` },
    { value: P(f.atr), label: `usual 1-hour move (${Q(f.atrPctOfPrice, 2)}% of price)` },
    { value: f.volatilityWord === "quiet" ? "Quiet" : f.volatilityWord === "active" ? "Active" : "Normal", label: f.atrRatio === null ? "volatility" : `volatility (${Q(f.atrRatio, 2)}x its recent average)` },
  ];
  if (f.macro) chips.push({ value: f.macro.label, label: `macro alignment (${Math.round(f.macro.alignmentPct)}%)` });
  used.push(...(f.macro ? [Math.round(f.macro.alignmentPct)] : []));
  sections.push({ heading: "Key numbers", kind: "chips", chips, body: chips.map((c) => `${c.value}: ${c.label}`).join(" | ") });

  // ---- hero chart -----------------------------------------------------------------------------------------------------------
  if (opts.chartUrl) {
    sections.push({
      heading: "Chart",
      kind: "hero",
      body: `Chart: ${f.pair} ${f.timeframeLabel} drawn by the Pro Chart engine.`,
      image: {
        url: opts.chartUrl,
        alt: `${f.pair} ${f.timeframeLabel} chart with structure, zones and key levels`,
        caption: "Drawn by our Pro Chart engine, the same one used in the dashboard. Green areas: buyers' zones. Red areas: sellers' zones. Blue: fair value gaps. Dashed lines: levels. Context, not a signal.",
      },
    });
  }

  // ---- technical ------------------------------------------------------------------------------------------------------------
  const tech: string[] = [];
  if (f.ema20 !== null && f.ema50 !== null) {
    if (s === "bullish") tech.push(`Short-term turn up. Price ${P(f.price)} is above its 20-hour and 50-hour averages (${P(f.ema20)} and ${P(f.ema50)}).`);
    else if (s === "bearish") tech.push(`Short-term lean down. Price ${P(f.price)} is below its 20-hour and 50-hour averages (${P(f.ema20)} and ${P(f.ema50)}).`);
    else tech.push(`No clear short-term lean. Price ${P(f.price)} sits between or around its 20-hour and 50-hour averages (${P(f.ema20)} and ${P(f.ema50)}).`);
  }
  if (f.lastBreak) tech.push(`The latest structure break is a ${f.lastBreak.bias} ${f.lastBreak.kind} at ${P(f.lastBreak.price)}.`);
  if (h) tech.push(h === "bullish" ? "The 4-hour picture is up: price is above its 4-hour averages." : h === "bearish" ? "The 4-hour picture is still down: price is below its 4-hour averages." : "The 4-hour picture is mixed: price is not clearly above or below its 4-hour averages.");
  if (f.rsi14 !== null) {
    const r = f.rsi14;
    used.push(Math.round(r));
    tech.push(`Momentum is ${r >= 70 ? "stretched on the upside" : r <= 30 ? "stretched on the downside" : r >= 55 ? "firm, not stretched" : r <= 45 ? "soft, not stretched" : "neutral"}. RSI(14) is ${Math.round(r)}.`);
  }
  const lv: string[] = [];
  if (f.resistance) lv.push(`resistance ${P(f.resistance.price)} (touched ${f.resistance.touches} times, ${Q(f.resistance.distanceAtr, 1)} ATR away)`);
  if (f.support) lv.push(`support ${P(f.support.price)} (touched ${f.support.touches} times, ${Q(f.support.distanceAtr, 1)} ATR away)`);
  if (lv.length) tech.push(`Nearest levels: ${lv.join("; ")}. ATR is the usual size of a one-hour move.`);
  if (f.prevDayHigh !== null && f.prevDayLow !== null) tech.push(`Yesterday's range: high ${P(f.prevDayHigh)}, low ${P(f.prevDayLow)}.`);
  const zl = (z: NonNullable<BriefFacts["zoneAbove"]>) => `${z.kind === "fvg" ? "fair value gap" : z.kind === "orderBlock" ? (z.bias === "bullish" ? "demand block" : "supply block") : "breaker block"} ${P(z.low)} to ${P(z.high)}`;
  const zs: string[] = [];
  if (f.zoneAbove) zs.push(`above price: ${zl(f.zoneAbove)}`);
  if (f.zoneBelow) zs.push(`below price: ${zl(f.zoneBelow)}`);
  if (zs.length) tech.push(`Nearest mapped zones, ${zs.join("; ")}.`);
  sections.push({ heading: "The technical picture, in plain words", kind: "bullets", bullets: tech, body: tech.map((t) => `- ${t}`).join("\n") });

  // ---- fundamental ----------------------------------------------------------------------------------------------------------
  const fund: string[] = [];
  if (f.macro) fund.push(`Macro drivers (dollar, yields, risk mood and more): ${Math.round(f.macro.alignmentPct)}% of the weight points the same way, so the reading is ${f.macro.label.toLowerCase()}.`);
  for (const e of f.events) fund.push(`Next on the calendar: ${e.title} (${e.whenIst})${e.forecast ? `, forecast ${e.forecast}` : ""}${e.previous ? `, previous ${e.previous}` : ""}.`);
  if (f.weekend) fund.push(f.category === "crypto" ? "It is the weekend: traditional markets are closed, so moves can be thinner than on a weekday." : "It is the weekend: this market is closed, so the chart shows the last session.");
  fund.push(`Volatility is ${f.volatilityWord}: the usual one-hour move is ${P(f.atr)}, which is ${Q(f.atrPctOfPrice, 2)}% of price.`);
  if (!f.macro && f.events.length === 0) fund.push("Macro drivers and calendar events were not available for this edition.");
  sections.push({ heading: "The fundamental picture, in plain words", kind: "bullets", bullets: fund, body: fund.map((t) => `- ${t}`).join("\n") });

  // ---- how they fit ----------------------------------------------------------------------------------------------------------
  const R = f.resistance ? P(f.resistance.price) : null;
  const S = f.support ? P(f.support.price) : null;
  const macroClause = f.macro ? ` and the macro mood is ${f.macro.label.toLowerCase()}` : "";
  let fit: string;
  if (s === "bullish" && h === "bearish") fit = `Buyers are active on the 1-hour chart while the 4-hour chart is still down${macroClause}. ${R ? `That makes ${R} the area to watch: acceptance above it would strengthen the bounce; below it, the larger picture stays in charge.` : "The next clear level above price is the area to watch."}`;
  else if (s === "bullish") fit = `The 1-hour chart leans up${h === "bullish" ? " and the 4-hour chart agrees" : ""}${macroClause}. ${R ? `${R} is the first area to watch above price` : "There is no mapped resistance above price"}${S ? `, with ${S} as the support area behind it.` : "."}`;
  else if (s === "bearish" && h === "bullish") fit = `The 1-hour chart is dipping while the 4-hour chart is still up${macroClause}. ${S ? `${S} is the support area to watch: holding it keeps the bigger uptrend intact.` : "The next clear level below price is the area to watch."}`;
  else if (s === "bearish") fit = `The 1-hour chart leans down${h === "bearish" ? " and the 4-hour chart agrees" : ""}${macroClause}. ${S ? `${S} is the first area to watch below price` : "There is no mapped support below price"}${R ? `, with ${R} as the resistance area above.` : "."}`;
  else fit = `The charts do not lean clearly one way${macroClause}. ${R && S ? `The range between ${S} and ${R} is the area to watch; a close outside it would give the first clue.` : "A move beyond the nearest levels would give the first clue."}`;
  sections.push({ heading: "How the two fit together", kind: "fit", body: fit });

  // ---- scenarios -------------------------------------------------------------------------------------------------------------
  const dom: Trend = s !== "mixed" ? s : h ?? "mixed";
  const e20t = f.ema20 !== null ? P(f.ema20) : null;
  const e50t = f.ema50 !== null ? P(f.ema50) : null;
  const cards: { title: string; body: string; tone: "up" | "down" | "neutral" }[] = [];
  if (dom === "bullish") {
    cards.push({ tone: "up", title: "A. The move up continues", body: `Price holds above the 50-hour average${e50t ? ` (about ${e50t})` : ""}${R ? ` and breaks ${R}` : ""}. The usual one-hour move is ${P(f.atr)}.` });
    cards.push({ tone: "neutral", title: "B. The move pauses", body: `Price loses the 20-hour average${e20t ? ` (${e20t})` : ""}${S ? ` and returns toward ${S}` : ""}. The bigger picture then decides.` });
  } else if (dom === "bearish") {
    cards.push({ tone: "down", title: "A. The move down continues", body: `Price stays below the 50-hour average${e50t ? ` (about ${e50t})` : ""}${S ? ` and breaks ${S}` : ""}. The usual one-hour move is ${P(f.atr)}.` });
    cards.push({ tone: "neutral", title: "B. The move pauses", body: `Price reclaims the 20-hour average${e20t ? ` (${e20t})` : ""}${R ? ` and moves toward ${R}` : ""}. The bigger picture then decides.` });
  } else {
    cards.push({ tone: "up", title: "A. A break higher", body: R ? `A close above ${R} would turn the short-term picture up.` : "A close above the nearest resistance would turn the short-term picture up." });
    cards.push({ tone: "down", title: "B. A break lower", body: S ? `A close below ${S} would turn the short-term picture down.` : "A close below the nearest support would turn the short-term picture down." });
  }
  sections.push({ heading: "Two scenarios", kind: "scenarios", cards, body: cards.map((c) => `${c.title}: ${c.body}`).join("\n") });

  // ---- plan ------------------------------------------------------------------------------------------------------------------
  let planText: string;
  const p = f.plan;
  if (p.state === "plan") {
    const risk = Math.abs(p.entry - p.stop);
    const rec = p.record && p.record.n >= 30 ? ` Measured record of the same rule on this chart's history: ${p.record.n} cases, average ${Q(p.record.avgR, 2)} R before costs.` : " The measured record has too few cases to quote.";
    planText = `A ${p.dir} plan is mapped: ${p.entryType === "limit" ? "wait for a retrace to" : "enter at"} ${P(p.entry)}, stop ${P(p.stop)} (${Q(risk / f.atr, 1)} ATR), target ${P(p.target)} (${p.rr} R). ${p.score} of ${p.scoreMax} confluences line up.${rec} A plan is a stated set of levels, not a prediction. Size it to your own risk limit.`;
  } else {
    planText = `No clean setup right now: waiting for a cleaner area. ${p.reason} When a plan appears it is shown on the chart with entry, stop and target, together with its measured record.`;
  }
  sections.push({ heading: "Trade plan today", kind: "plan", body: planText });

  // ---- yesterday's check ------------------------------------------------------------------------------------------------------
  if (opts.previous) {
    const pv = opts.previous;
    const parts: string[] = [];
    if (pv.levels.resistance !== null) parts.push(`We marked ${P(pv.levels.resistance)} as resistance: price ${pv.high >= pv.levels.resistance ? `reached it (high ${P(pv.high)})` : `stayed below it (high ${P(pv.high)})`} and ${pv.close >= pv.levels.resistance ? "closed above it" : "closed below it"}.`);
    if (pv.levels.support !== null) parts.push(`We marked ${P(pv.levels.support)} as support: price ${pv.low <= pv.levels.support ? `reached it (low ${P(pv.low)})` : `stayed above it (low ${P(pv.low)})`} and ${pv.close >= pv.levels.support ? "closed above it" : "closed below it"}.`);
    if (parts.length) sections.push({ heading: "Yesterday's check", kind: "check", body: `${parts.join(" ")} Levels are areas to study, not forecasts; this check shows what we can learn from them.` });
  }

  // ---- learn box -------------------------------------------------------------------------------------------------------------
  let learn: string;
  if (f.lastBreak?.kind === "CHoCH") learn = "Change of character (CHoCH). The first break against the previous direction, a sign the side in control may be changing. It describes what happened; it does not predict what comes next. Watch the lesson \"Trend and Market Structure\".";
  else if (f.lastBreak) learn = "Break of structure (BOS). Price closes beyond the last swing high or low, in the direction of the trend. It describes what happened; it does not predict what comes next. Watch the lesson \"Trend and Market Structure\".";
  else learn = "ATR (average true range). The usual size of a one-hour move. Use it to judge how far a level is, for example 2 ATR away. Watch the lesson \"Moving Averages, RSI and ATR\".";
  sections.push({ heading: "Learn in 30 seconds", kind: "learn", body: learn });

  // ---- footer ----------------------------------------------------------------------------------------------------------------
  sections.push({
    heading: "How this is made",
    kind: "footer",
    body: `A rule-based system reads price structure, volatility, macro drivers and the calendar; every number in the text comes from the same computed facts that draw the chart. Our own back-tests found no reliable directional edge in structure readings, so this is context and arithmetic for your own research. ${DISCLAIMER}`,
  });

  const summary = `${headline}. ${f.pair} ${P(f.price)}, volatility ${f.volatilityWord}.`.slice(0, 300);
  return { title: headline, summary, sections, usedNumbers: used };
}

// services/macro/macro-alignment.ts
// AT24 "Macro Alignment" - how many of the macro drivers that matter for GOLD
// currently lean the same way. PURE and deterministic: no network, no clock, no
// LLM. The same inputs always give the same score, and the formula is shown to
// the user on the card (see FORMULA below).
//
// What this is NOT: a forecast or a probability that price will move. A score of
// 82% means "drivers carrying 82% of the weight lean the same way right now" - it
// is a rule-based agreement measure. The weights are a research-based choice
// (real yields and the dollar are the most-cited gold drivers), not a proven
// edge, and the card says so.

export type DriverId = "realYield" | "dollar" | "yields" | "riskSentiment" | "momentum";
/** +1 supports gold, -1 is a headwind for gold, 0 neutral. */
export type DriverSign = -1 | 0 | 1;
export type AlignmentLean = "supportive" | "headwind" | "mixed" | "insufficient";

export interface DriverInput {
  /** Raw measurement; null = the data was not available (never guessed). */
  value: number | null;
  /** What `value` is, for display, e.g. "% day change" or "pp over 5 days". */
  unit: string;
  /** Where it came from, shown on the card. */
  source: string;
  /** ISO time of the underlying observation, when known. */
  asOf?: string | null;
}

export type MacroInputs = Record<DriverId, DriverInput>;

export interface DriverReading {
  id: DriverId;
  label: string;
  weight: number;
  available: boolean;
  sign: DriverSign;
  value: number | null;
  unit: string;
  source: string;
  asOf: string | null;
  /** One plain sentence: what the reading means for gold. */
  detail: string;
}

export interface MacroAlignment {
  lean: AlignmentLean;
  /** 0-100: weight share of the drivers agreeing with the lean. null when insufficient. */
  score: number | null;
  label: string;
  drivers: DriverReading[];
  availableDrivers: number;
  totalDrivers: number;
  formula: string;
  caveat: string;
}

export const FORMULA =
  "Each driver reads +1 (supports gold), -1 (headwind) or 0 (neutral). Lean = sign of the weighted sum. Score = share of total driver weight that points the same way as the lean.";
export const CAVEAT =
  "Rule-based agreement of macro drivers, not a forecast. Weights are a research-based choice, not a proven edge. Decision support only.";

/** Drivers with fewer than this many readings give no score. */
export const MIN_DRIVERS = 3;

interface DriverSpec {
  id: DriverId;
  label: string;
  weight: number;
  /** Threshold below which the move is treated as noise (0). */
  threshold: number;
  /** +1 when value moves in this direction (signed multiplier applied to value). */
  direction: 1 | -1;
  describe: (sign: DriverSign, value: number) => string;
}

const f2 = (n: number) => (Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2));
const signed = (n: number) => `${n > 0 ? "+" : ""}${f2(n)}`;

export const DRIVER_SPECS: readonly DriverSpec[] = [
  {
    id: "realYield", label: "Real yield (10Y TIPS)", weight: 30, threshold: 0.05, direction: -1,
    describe: (s, v) => (s > 0 ? `Real yield falling (${signed(v)} pp) - cheaper to hold gold` : s < 0 ? `Real yield rising (${signed(v)} pp) - holding gold costs more` : `Real yield flat (${signed(v)} pp)`),
  },
  {
    id: "dollar", label: "US dollar", weight: 20, threshold: 0.15, direction: -1,
    describe: (s, v) => (s > 0 ? `Dollar weaker (${signed(v)}%) - supports gold` : s < 0 ? `Dollar stronger (${signed(v)}%) - pressures gold` : `Dollar little changed (${signed(v)}%)`),
  },
  {
    id: "yields", label: "Treasury yields", weight: 15, threshold: 0.15, direction: 1,
    describe: (s, v) => (s > 0 ? `Treasuries bid (${signed(v)}%), yields easing` : s < 0 ? `Treasuries sold (${signed(v)}%), yields rising` : `Treasuries little changed (${signed(v)}%)`),
  },
  {
    id: "riskSentiment", label: "Risk sentiment", weight: 10, threshold: 2, direction: 1,
    describe: (s, v) => (s > 0 ? `Volatility bid (${signed(v)}%) - safe-haven demand` : `Volatility calm (${signed(v)}%)`),
  },
  {
    id: "momentum", label: "Gold momentum", weight: 25, threshold: 0.3, direction: 1,
    describe: (s, v) => (s > 0 ? `Gold up ${signed(v)}% today` : s < 0 ? `Gold down ${signed(v)}% today` : `Gold little changed (${signed(v)}%)`),
  },
];

export const TOTAL_WEIGHT = DRIVER_SPECS.reduce((a, d) => a + d.weight, 0);

function signFor(spec: DriverSpec, value: number): DriverSign {
  const v = value * spec.direction;
  if (spec.id === "riskSentiment") return v >= spec.threshold ? 1 : 0; // calm is neutral, never bearish for gold
  if (v >= spec.threshold) return 1;
  if (v <= -spec.threshold) return -1;
  return 0;
}

export function computeMacroAlignment(inputs: MacroInputs): MacroAlignment {
  const drivers: DriverReading[] = DRIVER_SPECS.map((spec) => {
    const inp = inputs[spec.id];
    const available = inp !== undefined && typeof inp.value === "number" && Number.isFinite(inp.value);
    const value = available ? (inp.value as number) : null;
    const sign: DriverSign = value === null ? 0 : signFor(spec, value);
    return {
      id: spec.id,
      label: spec.label,
      weight: spec.weight,
      available,
      sign,
      value,
      unit: inp?.unit ?? "",
      source: inp?.source ?? "",
      asOf: inp?.asOf ?? null,
      detail: value === null ? "Data not available right now" : spec.describe(sign, value),
    };
  });

  const live = drivers.filter((d) => d.available);
  const base = { drivers, availableDrivers: live.length, totalDrivers: drivers.length, formula: FORMULA, caveat: CAVEAT };
  if (live.length < MIN_DRIVERS) {
    return { ...base, lean: "insufficient", score: null, label: "Not enough data" };
  }

  const liveWeight = live.reduce((a, d) => a + d.weight, 0);
  const net = live.reduce((a, d) => a + d.weight * d.sign, 0);
  const lean: AlignmentLean = net > 0 ? "supportive" : net < 0 ? "headwind" : "mixed";
  if (lean === "mixed") {
    // exact tie in weight: every available driver neutral or perfectly offsetting
    const neutralShare = live.filter((d) => d.sign === 0).reduce((a, d) => a + d.weight, 0);
    return { ...base, lean, score: Math.round((neutralShare / liveWeight) * 100), label: "Mixed" };
  }
  const dominant: DriverSign = lean === "supportive" ? 1 : -1;
  const agreeing = live.filter((d) => d.sign === dominant).reduce((a, d) => a + d.weight, 0);
  const score = Math.round((agreeing / liveWeight) * 100);
  // A lean backed by under half the weight is "mixed", not a conviction.
  if (score < 50) return { ...base, lean: "mixed", score, label: "Mixed" };
  return { ...base, lean, score, label: lean === "supportive" ? "Supports gold" : "Headwind for gold" };
}

/** One plain line for Telegram / push / brief. */
export function alignmentLine(a: MacroAlignment): string {
  if (a.score === null) return "Macro alignment: not enough data right now";
  return `Macro alignment ${a.score}% - ${a.label} (${a.availableDrivers}/${a.totalDrivers} drivers)`;
}

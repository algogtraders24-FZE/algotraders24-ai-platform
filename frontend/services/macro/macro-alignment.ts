// services/macro/macro-alignment.ts
// AT24 "Macro Alignment" - how many of the macro drivers that matter for an
// ASSET currently lean the same way. PURE and deterministic: no network, no
// clock, no LLM. The same inputs always give the same score, and the formula is
// shown to the user on the card (see FORMULA below).
//
// What this is NOT: a forecast or a probability that price will move. A score of
// 82% means "drivers carrying 82% of the weight lean the same way right now" - it
// is a rule-based agreement measure. The weights are a research-based choice per
// asset (the most-cited drivers), not a proven edge, and the card says so. Each
// asset also lists what the score does NOT cover (`notCovered`).
//
// "Supports" always means "favours a higher price of the asset".

export type DriverId = "realYield" | "nominalYield" | "dollar" | "yields" | "riskAppetite" | "riskSentiment" | "momentum";
export type AssetId = "gold" | "silver" | "eurusd" | "gbpusd" | "usdjpy" | "btcusd" | "ethusd" | "oil";
/** +1 supports the asset, -1 is a headwind, 0 neutral. */
export type DriverSign = -1 | 0 | 1;
export type AlignmentLean = "supportive" | "headwind" | "mixed" | "insufficient";

export interface DriverInput {
  /** Raw measurement; null = the data was not available (never guessed). */
  value: number | null;
  unit: string;
  /** Where it came from, shown on the card. */
  source: string;
  /** ISO time of the underlying observation, when known. */
  asOf?: string | null;
}

export type MacroInputs = Partial<Record<DriverId, DriverInput>>;

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
  /** One plain sentence: what the reading means for the asset. */
  detail: string;
}

export interface MacroAlignment {
  asset: AssetId;
  lean: AlignmentLean;
  /** 0-100: weight share of the drivers agreeing with the lean. null when insufficient. */
  score: number | null;
  label: string;
  drivers: DriverReading[];
  availableDrivers: number;
  totalDrivers: number;
  formula: string;
  caveat: string;
  /** What this score does not look at. */
  notCovered: string[];
}

export const FORMULA =
  "Each driver reads +1 (supports the asset, i.e. favours a higher price), -1 (headwind) or 0 (neutral). Lean = sign of the weighted sum. Score = share of total driver weight that points the same way as the lean.";
export const CAVEAT =
  "Rule-based agreement of macro drivers, not a forecast. Weights are a research-based choice, not a proven edge. Decision support only.";

/** Fewer available drivers than this give no score. */
export const MIN_DRIVERS = 3;
/** The drivers that have data must carry at least this share of the profile's total weight, otherwise no score: a verdict built from a minority of the weight (e.g. oil without its own price, weight 40) would mislead. */
export const MIN_COVERAGE = 0.7;

interface DriverSpec {
  id: DriverId;
  label: string;
  weight: number;
  /** Moves smaller than this (in the input's unit) are noise (0). */
  threshold: number;
  /** Multiplier applied to the value before comparing with the threshold (-1: a fall supports the asset). */
  direction: 1 | -1;
  /** Only a rise past the threshold counts; anything else is neutral. "support": the rise helps the asset, "headwind": it hurts. */
  spike?: "support" | "headwind";
}

export interface AssetProfile {
  id: AssetId;
  /** Short name used in sentences, e.g. "gold", "EUR/USD". */
  name: string;
  title: string;
  supportLabel: string;
  headwindLabel: string;
  /** Twelve Data symbol of the asset's own quote (momentum + price). */
  /** `symbol`/`source` = the Twelve Data quote (fallback); `mt5` = the Exness symbol tried first, when the bridge has it. */
  ownQuote: { symbol: string; source: string; mt5?: string };
  /** `fallbackLabel` is used when the price came from the proxy instead of the real instrument. */
  price: { label: string; prefix: string; decimals: number; fallbackLabel?: string };
  /** Symbol the Market Intelligence agent uses for this asset, when it supports it. */
  miSymbol: string | null;
  /** Calendar currencies whose high-impact events matter. */
  calendarCurrencies: string[];
  drivers: readonly DriverSpec[];
  notCovered: string[];
}

export const ASSET_PROFILES: Record<AssetId, AssetProfile> = {
  gold: {
    id: "gold", name: "gold", title: "Gold", supportLabel: "Supports gold", headwindLabel: "Headwind for gold",
    ownQuote: { symbol: "XAU/USD", source: "XAU/USD", mt5: "XAUUSD" },
    price: { label: "Gold", prefix: "$", decimals: 2 },
    miSymbol: "XAUUSD", calendarCurrencies: ["USD"],
    drivers: [
      { id: "realYield", label: "Real yield (10Y TIPS)", weight: 30, threshold: 0.05, direction: -1 },
      { id: "dollar", label: "US dollar", weight: 20, threshold: 0.15, direction: -1 },
      { id: "yields", label: "Treasury yields", weight: 15, threshold: 0.15, direction: 1 },
      { id: "riskSentiment", label: "Risk sentiment", weight: 10, threshold: 2, direction: 1, spike: "support" },
      { id: "momentum", label: "Gold momentum", weight: 25, threshold: 0.3, direction: 1 },
    ],
    notCovered: ["central-bank buying", "geopolitical headlines"],
  },
  silver: {
    id: "silver", name: "silver", title: "Silver", supportLabel: "Supports silver", headwindLabel: "Headwind for silver",
    ownQuote: { symbol: "SLV", source: "SLV (silver ETF proxy)", mt5: "XAGUSD" },
    price: { label: "Silver", prefix: "$", decimals: 2, fallbackLabel: "SLV silver ETF" },
    miSymbol: "XAGUSD", calendarCurrencies: ["USD"],
    drivers: [
      { id: "realYield", label: "Real yield (10Y TIPS)", weight: 25, threshold: 0.05, direction: -1 },
      { id: "dollar", label: "US dollar", weight: 20, threshold: 0.15, direction: -1 },
      { id: "riskAppetite", label: "Risk appetite (stocks)", weight: 10, threshold: 0.4, direction: 1 },
      { id: "yields", label: "Treasury yields", weight: 10, threshold: 0.15, direction: 1 },
      { id: "momentum", label: "Silver momentum (SLV)", weight: 35, threshold: 0.5, direction: 1 },
    ],
    notCovered: ["industrial demand", "the gold/silver ratio", "if the Exness silver quote is unavailable an ETF proxy (SLV) is used and labelled on the card"],
  },
  eurusd: {
    id: "eurusd", name: "EUR/USD", title: "EUR/USD", supportLabel: "Supports EUR/USD", headwindLabel: "Headwind for EUR/USD",
    ownQuote: { symbol: "EUR/USD", source: "EUR/USD", mt5: "EURUSD" },
    price: { label: "EUR/USD", prefix: "", decimals: 4 },
    miSymbol: "EURUSD", calendarCurrencies: ["USD", "EUR"],
    drivers: [
      { id: "dollar", label: "US dollar", weight: 30, threshold: 0.15, direction: -1 },
      { id: "yields", label: "Treasury yields", weight: 15, threshold: 0.15, direction: 1 },
      { id: "riskAppetite", label: "Risk appetite (stocks)", weight: 15, threshold: 0.4, direction: 1 },
      { id: "riskSentiment", label: "Risk sentiment", weight: 10, threshold: 2, direction: 1, spike: "headwind" },
      { id: "momentum", label: "EUR/USD momentum", weight: 30, threshold: 0.2, direction: 1 },
    ],
    notCovered: ["euro-area data and ECB policy", "the dollar driver largely mirrors EUR/USD itself (EUR is most of the dollar basket), so dollar and momentum overlap"],
  },
  gbpusd: {
    id: "gbpusd", name: "GBP/USD", title: "GBP/USD", supportLabel: "Supports GBP/USD", headwindLabel: "Headwind for GBP/USD",
    ownQuote: { symbol: "GBP/USD", source: "GBP/USD", mt5: "GBPUSD" },
    price: { label: "GBP/USD", prefix: "", decimals: 4 },
    miSymbol: "GBPUSD", calendarCurrencies: ["USD", "GBP"],
    drivers: [
      { id: "dollar", label: "US dollar", weight: 30, threshold: 0.15, direction: -1 },
      { id: "yields", label: "Treasury yields", weight: 15, threshold: 0.15, direction: 1 },
      { id: "riskAppetite", label: "Risk appetite (stocks)", weight: 15, threshold: 0.4, direction: 1 },
      { id: "riskSentiment", label: "Risk sentiment", weight: 10, threshold: 2, direction: 1, spike: "headwind" },
      { id: "momentum", label: "GBP/USD momentum", weight: 30, threshold: 0.2, direction: 1 },
    ],
    notCovered: ["UK data and Bank of England policy", "the dollar driver largely mirrors GBP/USD itself, so dollar and momentum overlap"],
  },
  usdjpy: {
    id: "usdjpy", name: "USD/JPY", title: "USD/JPY", supportLabel: "Supports USD/JPY", headwindLabel: "Headwind for USD/JPY",
    ownQuote: { symbol: "USD/JPY", source: "USD/JPY", mt5: "USDJPY" },
    price: { label: "USD/JPY", prefix: "", decimals: 2 },
    miSymbol: "USDJPY", calendarCurrencies: ["USD", "JPY"],
    drivers: [
      { id: "nominalYield", label: "US 10Y yield", weight: 30, threshold: 0.05, direction: 1 },
      { id: "yields", label: "Treasury yields (live proxy)", weight: 20, threshold: 0.15, direction: -1 },
      { id: "riskAppetite", label: "Risk appetite (stocks)", weight: 15, threshold: 0.4, direction: 1 },
      { id: "riskSentiment", label: "Risk sentiment", weight: 10, threshold: 2, direction: 1, spike: "headwind" },
      { id: "momentum", label: "USD/JPY momentum", weight: 25, threshold: 0.2, direction: 1 },
    ],
    notCovered: ["Bank of Japan policy and intervention risk", "Japan data"],
  },
  btcusd: {
    id: "btcusd", name: "Bitcoin", title: "Bitcoin", supportLabel: "Supports Bitcoin", headwindLabel: "Headwind for Bitcoin",
    ownQuote: { symbol: "BTC/USD", source: "BTC/USD", mt5: "BTCUSD" },
    price: { label: "Bitcoin", prefix: "$", decimals: 0 },
    miSymbol: "BTCUSD", calendarCurrencies: ["USD"],
    drivers: [
      { id: "riskAppetite", label: "Risk appetite (stocks)", weight: 25, threshold: 0.4, direction: 1 },
      { id: "dollar", label: "US dollar", weight: 15, threshold: 0.15, direction: -1 },
      { id: "realYield", label: "Real yield (10Y TIPS)", weight: 20, threshold: 0.05, direction: -1 },
      { id: "riskSentiment", label: "Risk sentiment", weight: 10, threshold: 2, direction: 1, spike: "headwind" },
      { id: "momentum", label: "Bitcoin momentum", weight: 30, threshold: 1, direction: 1 },
    ],
    notCovered: ["on-chain flows and ETF flows", "exchange or regulatory news"],
  },
  ethusd: {
    id: "ethusd", name: "Ethereum", title: "Ethereum", supportLabel: "Supports Ethereum", headwindLabel: "Headwind for Ethereum",
    ownQuote: { symbol: "ETH/USD", source: "ETH/USD", mt5: "ETHUSD" },
    price: { label: "Ethereum", prefix: "$", decimals: 0 },
    miSymbol: "ETHUSD", calendarCurrencies: ["USD"],
    drivers: [
      { id: "riskAppetite", label: "Risk appetite (stocks)", weight: 25, threshold: 0.4, direction: 1 },
      { id: "dollar", label: "US dollar", weight: 15, threshold: 0.15, direction: -1 },
      { id: "realYield", label: "Real yield (10Y TIPS)", weight: 20, threshold: 0.05, direction: -1 },
      { id: "riskSentiment", label: "Risk sentiment", weight: 10, threshold: 2, direction: 1, spike: "headwind" },
      { id: "momentum", label: "Ethereum momentum", weight: 30, threshold: 1.2, direction: 1 },
    ],
    notCovered: ["on-chain and ETF flows", "network activity and staking", "exchange or regulatory news"],
  },
  oil: {
    id: "oil", name: "crude oil", title: "Crude oil (WTI)", supportLabel: "Supports crude oil", headwindLabel: "Headwind for crude oil",
    ownQuote: { symbol: "USO", source: "USO (WTI oil ETF proxy)", mt5: "USOIL" },
    price: { label: "Crude oil (WTI)", prefix: "$", decimals: 2, fallbackLabel: "USO oil ETF" },
    miSymbol: null, calendarCurrencies: ["USD"],
    drivers: [
      { id: "dollar", label: "US dollar", weight: 25, threshold: 0.15, direction: -1 },
      { id: "riskAppetite", label: "Risk appetite (stocks)", weight: 25, threshold: 0.4, direction: 1 },
      { id: "riskSentiment", label: "Risk sentiment", weight: 10, threshold: 2, direction: 1, spike: "headwind" },
      { id: "momentum", label: "Oil momentum (USO)", weight: 40, threshold: 0.8, direction: 1 },
    ],
    notCovered: ["inventories and OPEC+ supply decisions", "geopolitical supply risk", "if the Exness WTI quote is unavailable an ETF proxy (USO) is used and labelled on the card"],
  },
};

export const ASSET_IDS = Object.keys(ASSET_PROFILES) as AssetId[];
export const isAssetId = (v: string): v is AssetId => (ASSET_IDS as string[]).includes(v);
export function profileForMiSymbol(symbol: string): AssetProfile | null {
  return Object.values(ASSET_PROFILES).find((p) => p.miSymbol === symbol) ?? null;
}
export const profileTotalWeight = (p: AssetProfile): number => p.drivers.reduce((a, d) => a + d.weight, 0);

const f2 = (n: number) => (Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2));
const signed = (n: number) => `${n > 0 ? "+" : ""}${f2(n)}`;

function signFor(spec: DriverSpec, value: number): DriverSign {
  const v = value * spec.direction;
  if (spec.spike) {
    if (value < spec.threshold) return 0;
    return spec.spike === "support" ? 1 : -1;
  }
  if (v >= spec.threshold) return 1;
  if (v <= -spec.threshold) return -1;
  return 0;
}

function impact(sign: DriverSign, asset: AssetProfile): string {
  return sign > 0 ? `supports ${asset.name}` : sign < 0 ? `pressures ${asset.name}` : "little effect";
}

function describe(spec: DriverSpec, sign: DriverSign, v: number, asset: AssetProfile): string {
  const tail = impact(sign, asset);
  // Inside the noise threshold the wording must not claim a direction.
  const flat = !spec.spike && Math.abs(v) < spec.threshold;
  switch (spec.id) {
    case "realYield": return `Real yield ${flat ? "little changed" : v < 0 ? "falling" : "rising"} (${signed(v)} pp over 5 days) - ${tail}`;
    case "nominalYield": return `US 10Y yield ${flat ? "little changed" : v < 0 ? "falling" : "rising"} (${signed(v)} pp over 5 days) - ${tail}`;
    case "dollar": return `Dollar ${flat ? "little changed" : v < 0 ? "weaker" : "stronger"} (${signed(v)}%) - ${tail}`;
    case "yields": return `Treasuries ${flat ? "little changed" : v > 0 ? "bid, yields easing" : "sold, yields rising"} (${signed(v)}%) - ${tail}`;
    case "riskAppetite": return `Stocks ${flat ? "little changed" : v > 0 ? "rising (risk-on)" : "falling (risk-off)"} (${signed(v)}%) - ${tail}`;
    case "riskSentiment": return `Volatility ${sign !== 0 ? "rising" : "calm"} (${signed(v)}%) - ${tail}`;
    case "momentum": return `${asset.id === "oil" ? "Oil" : asset.title} ${flat ? "little changed" : v > 0 ? "up" : "down"} ${signed(v)}% today - ${tail}`;
  }
}

export function computeMacroAlignment(inputs: MacroInputs, profile: AssetProfile = ASSET_PROFILES.gold): MacroAlignment {
  const drivers: DriverReading[] = profile.drivers.map((spec) => {
    const inp = inputs[spec.id];
    const available = inp !== undefined && typeof inp.value === "number" && Number.isFinite(inp.value);
    const value = available ? (inp!.value as number) : null;
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
      detail: value === null ? "Data not available right now" : describe(spec, sign, value, profile),
    };
  });

  const live = drivers.filter((d) => d.available);
  const base = { asset: profile.id, drivers, availableDrivers: live.length, totalDrivers: drivers.length, formula: FORMULA, caveat: CAVEAT, notCovered: profile.notCovered };
  const liveWeight = live.reduce((a, d) => a + d.weight, 0);
  const totalWeight = drivers.reduce((a, d) => a + d.weight, 0);
  if (live.length < MIN_DRIVERS || liveWeight < MIN_COVERAGE * totalWeight) {
    return { ...base, lean: "insufficient", score: null, label: "Not enough data" };
  }

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
  return { ...base, lean, score, label: lean === "supportive" ? profile.supportLabel : profile.headwindLabel };
}

/** One plain line for Telegram / push / brief. */
export function alignmentLine(a: MacroAlignment): string {
  if (a.score === null) return "Macro alignment: not enough data right now";
  return `Macro alignment ${a.score}% - ${a.label} (${a.availableDrivers}/${a.totalDrivers} drivers)`;
}

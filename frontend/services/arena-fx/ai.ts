// services/arena-fx/ai.ts
// The prompt for the AI contestants and the strict parser of their answer. Pure: no network, no database.
// The AI sees only what the map shows NOW (prices, trends, nearest levels, range position) and is asked about the next day, so it cannot
// have seen the outcome. Its answer is parsed by code: an unknown market is ignored, a missing market is flat, any position outside -1, 0, +1 is flat.
import type { Pos } from "./engine";

export interface MapFeatures {
  w1: string | null;
  d1: string | null;
  h4: string | null;
  resistance: { pct: number; atr: number } | null;
  support: { pct: number; atr: number } | null;
  rangePos: number;
}

export interface PromptMarket {
  symbol: string;
  label: string;
  price: number;
  atrPct: number;
  alignment: string;
  features: MapFeatures;
}

export const SYSTEM_PROMPT = [
  "You are one contestant in a paper-trading arena on forex pairs, metals, energy and stock indices. Nothing here is real money.",
  "Every weekday you get a table of markets as they stand now. For each market choose a position for the next day: 1 = long, -1 = short, 0 = flat.",
  "You are scored in units of each market's daily ATR, after a cost of 0.03 ATR every time a position changes, against 200 random traders that decide by coin flip.",
  "Flat is a valid and often good answer. Doing nothing costs nothing; changing your mind costs 0.03 ATR each time. Do not invent news; you only know what the table shows.",
  'Answer with JSON only, no other text: {"decisions":[{"symbol":"EURUSD","position":1,"reason":"at most 15 words"}, ...]} with one entry per market in the table.',
].join("\n");

function fmt(v: number): string {
  const d = v >= 1000 ? 2 : v >= 100 ? 3 : v >= 10 ? 4 : 5;
  return v.toFixed(d);
}

function levelText(name: string, l: { pct: number; atr: number } | null): string {
  return l ? `${name} ${l.pct >= 0 ? "+" : ""}${l.pct.toFixed(2)}% (${Math.abs(l.atr).toFixed(2)} ATR)` : `${name} none`;
}

export function buildUserPrompt(nowIso: string, markets: ReadonlyArray<PromptMarket>): string {
  const lines = markets.map(
    (m) =>
      `${m.symbol} (${m.label}): price ${fmt(m.price)}, daily range ${m.atrPct.toFixed(2)}%, trend W/D/4H ${m.features.w1 ?? "-"}/${m.features.d1 ?? "-"}/${m.features.h4 ?? "-"} (${m.alignment}), ` +
      `${levelText("resistance", m.features.resistance)}, ${levelText("support", m.features.support)}, at ${m.features.rangePos.toFixed(0)}% of the 50-day range`,
  );
  return `Time (UTC): ${nowIso}\nMarkets now:\n${lines.join("\n")}\nGive your position for each market for the next day.`;
}

export interface ParsedDecision {
  symbol: string;
  position: Pos;
  reason: string | null;
}

export interface ParseResult {
  decisions: ParsedDecision[];
  /** Markets the answer did not cover (set flat). */
  missing: string[];
  /** Entries ignored: unknown market, bad shape. */
  ignored: number;
}

/** Extracts the JSON object from the model text (it may wrap it in a code fence) and validates it against the market list. Null when there is no usable JSON. */
export function parseDecisions(text: string, symbols: ReadonlyArray<string>): ParseResult | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let json: unknown;
  try {
    json = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const list = (json as { decisions?: unknown } | null)?.decisions;
  if (!Array.isArray(list)) return null;
  const wanted = new Set(symbols);
  const seen = new Map<string, ParsedDecision>();
  let ignored = 0;
  for (const raw of list) {
    const e = raw as { symbol?: unknown; position?: unknown; reason?: unknown } | null;
    if (!e || typeof e.symbol !== "string" || !wanted.has(e.symbol) || seen.has(e.symbol)) {
      ignored += 1;
      continue;
    }
    const p = Number(e.position);
    const position: Pos = p === 1 ? 1 : p === -1 ? -1 : 0;
    const reason = typeof e.reason === "string" ? e.reason.trim().slice(0, 160) : null;
    seen.set(e.symbol, { symbol: e.symbol, position, reason: reason || null });
  }
  const missing = symbols.filter((s) => !seen.has(s));
  const decisions = [...seen.values(), ...missing.map((symbol): ParsedDecision => ({ symbol, position: 0, reason: null }))];
  return { decisions, missing, ignored };
}

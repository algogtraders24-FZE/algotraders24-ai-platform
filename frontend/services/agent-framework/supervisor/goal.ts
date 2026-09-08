// services/agent-framework/supervisor/goal.ts
// AT24 Agent Framework - A5. Deterministic goal interpretation. NO LLM.
//
// The supervisor's first step: extract the structured parameters a plan
// needs (symbol, timeframe, the question text) and a cheap complexity
// signal that decides whether LLM-assisted planning is even considered.

import { isRecord } from "../tools/tool-implementation";

export interface ParsedGoal {
  /** Canonical instrument symbol if the goal names one. */
  symbol?: string;
  /** Timeframe token (e.g. "5m", "1h") if the goal names one. */
  timeframe?: string;
  /** The natural-language question / instruction. */
  question: string;
  /** True when the goal plausibly needs decomposition (multiple asks,
   *  comparison, sequencing). Only a heuristic - never a hard gate. */
  isComplex: boolean;
  /** The raw input, untouched, for downstream tools. */
  raw: unknown;
}

const SYMBOL_RE = /\b(XAU|XAG|BTC|ETH|SOL|XRP|EUR|GBP|USD|JPY|AUD|NZD|CAD|CHF)[A-Z]{3}\b/;
const BARE_SYMBOL_RE = /\b(XAUUSD|XAGUSD|BTCUSD|ETHUSD|SOLUSD|XRPUSD|EURUSD|GBPUSD|USDJPY|GOLD|SILVER)\b/i;
const TIMEFRAME_RE = /\b(\d{1,2})\s*(m|min|h|hour|d|day|w|week)\b|\b(M1|M5|M15|M30|H1|H4|D1|W1)\b/i;
const COMPLEX_MARKERS = [" and then ", " then ", " compare ", " versus ", " vs ", " after ", " both ", " also ", "step 1", "first,", "1)"];

export function parseGoal(input: unknown): ParsedGoal {
  let question = "";
  let symbol: string | undefined;
  let timeframe: string | undefined;

  if (typeof input === "string") {
    question = input;
  } else if (isRecord(input)) {
    if (typeof input.question === "string") question = input.question;
    else if (typeof input.goal === "string") question = input.goal;
    else if (typeof input.prompt === "string") question = input.prompt;
    if (typeof input.symbol === "string") symbol = input.symbol.toUpperCase();
    if (typeof input.timeframe === "string") timeframe = input.timeframe;
  }

  if (!symbol) {
    const m = question.match(BARE_SYMBOL_RE) ?? question.match(SYMBOL_RE);
    if (m) {
      const s = m[0].toUpperCase();
      symbol = s === "GOLD" ? "XAUUSD" : s === "SILVER" ? "XAGUSD" : s;
    }
  }
  if (!timeframe) {
    const m = question.match(TIMEFRAME_RE);
    if (m) timeframe = (m[3] ?? `${m[1]}${(m[2] ?? "").toLowerCase().charAt(0)}`).toString();
  }

  const lower = ` ${question.toLowerCase()} `;
  const isComplex =
    question.split(/[.!?]/).filter((s) => s.trim().length > 0).length > 1 ||
    question.trim().split(/\s+/).length > 28 ||
    COMPLEX_MARKERS.some((mk) => lower.includes(mk));

  return { symbol, timeframe, question: question.trim(), isComplex, raw: input };
}

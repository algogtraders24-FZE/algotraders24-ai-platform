// services/automation/brief.ts
// AT24 Automation Phase 2 - turns the raw output of an agent run into the
// short, human-readable "brief" a user actually wants to read (Run Detail,
// the Results feed, and the Telegram / push / bell messages).
//
// PURE and deterministic: no DB, no LLM, no clock. It only RE-STATES what the
// agent already produced - it never adds a claim, a number or a view of its
// own. An output with nothing worth reporting (e.g. a research brief with 0
// citations) is flagged `empty` so delivery can skip it instead of sending
// noise every morning.

import type { AgentBrief } from "@/types/automation";
export type { AgentBrief };

const MAX_LINES = 6;
const MAX_LINE_CHARS = 220;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function clip(s: string): string {
  return s.length > MAX_LINE_CHARS ? `${s.slice(0, MAX_LINE_CHARS - 1)}…` : s;
}

function stringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => clip(x.trim()));
}

/** Returns null only when `output` is not an object at all. */
export function composeAgentBrief(output: unknown): AgentBrief | null {
  if (!isRecord(output)) return null;
  const kind = str(output.kind) ?? "result";
  const disclaimer = str(output.disclaimer);

  if (kind === "market-intelligence-conclusion") {
    const symbol = str(output.symbol) ?? "instrument";
    const tf = str(output.timeframe);
    const label = tf ? `${symbol} ${tf}` : symbol;
    if (output.resolved === false) {
      return { kind, headline: `Market intelligence for ${label} was not available`, lines: [], disclaimer, empty: true };
    }
    const bias = str(output.bias) ?? "unclear";
    const regime = str(output.regimeType);
    const conf = num(output.regimeConfidence);
    const head = `${label}: ${bias}${regime ? ` · regime ${regime}${conf !== null ? ` (confidence ${conf})` : ""}` : ""}`;
    return { kind, headline: head, lines: stringList(output.basis).slice(0, MAX_LINES), disclaimer, empty: false };
  }

  if (kind === "research-brief") {
    const n = num(output.citationCount) ?? 0;
    const coverage = str(output.coverage) ?? "no-coverage";
    if (n === 0) {
      return { kind, headline: "Research: no matching sources found", lines: [], disclaimer, empty: true };
    }
    const sources = stringList(output.sources).slice(0, 4).map((s) => `Source: ${s}`);
    const q = str(output.question);
    return {
      kind,
      headline: `Research: ${n} source${n === 1 ? "" : "s"} (${coverage})`,
      lines: [...(q ? [`Question: ${clip(q)}`] : []), ...sources].slice(0, MAX_LINES),
      disclaimer,
      empty: false,
    };
  }

  if (kind === "strategy-research-brief") {
    const conclusion = str(output.conclusion);
    const hypothesis = str(output.hypothesis);
    if (!conclusion) {
      return { kind, headline: "Strategy research produced no usable result", lines: hypothesis ? [clip(hypothesis)] : [], disclaimer, empty: true };
    }
    return { kind, headline: clip(conclusion), lines: hypothesis ? [`Hypothesis: ${clip(hypothesis)}`] : [], disclaimer, empty: false };
  }

  // Unknown / generic agent output: say what it is, claim nothing more.
  return { kind, headline: `Result (${kind})`, lines: [], disclaimer, empty: false };
}

/** Plain-text rendering of one brief (headline + bullet lines). */
export function briefToText(b: AgentBrief): string {
  return [b.headline, ...b.lines.map((l) => `• ${l}`)].join("\n");
}

/** A single combined text for several briefs, empty ones dropped. "" if none. */
export function combineBriefsText(briefs: readonly (AgentBrief | null)[]): string {
  return briefs
    .filter((b): b is AgentBrief => b !== null && !b.empty)
    .map(briefToText)
    .join("\n\n");
}
